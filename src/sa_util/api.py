from django.http import HttpRequest, HttpResponse
from django.urls import reverse
import requests
from urllib.parse import urlparse

from django.conf import settings
from .config import get_shareabouts_config, _ShareaboutsConfig


def make_api_root(dataset_root):
    components = dataset_root.split('/')
    if dataset_root.endswith('/'):
        return '/'.join(components[:-4]) + '/'
    else:
        return '/'.join(components[:-3]) + '/'


def make_auth_root(dataset_root):
    return make_api_root(dataset_root) + 'users/'


def make_resource_uri(resource, root):
    resource = resource.lstrip('/')
    root = root.rstrip('/')
    uri = '%s/%s' % (root, resource)
    return uri


ApiSessionInfo = dict


def get_api_sessioninfo(django_http_request: HttpRequest) -> ApiSessionInfo:
    """
    Pull session cookie information from a Django HTTP request.
    """
    return {
        'id': django_http_request.COOKIES.get('sa-api-sessionid'),
        'domain': django_http_request.COOKIES.get('sa-api-sessiondomain'),
    }


def make_api_session(dataset_root, api_sessioninfo: ApiSessionInfo):
    """
    Create a requests session for the Shareabouts API.
    """
    api_session = requests.Session()
    api_session.headers['Content-type'] = 'application/json'
    api_session.headers['Accept'] = 'application/json'

    if api_sessioninfo:
        api_session.cookies.set(
            'sessionid',
            api_sessioninfo.get('id', ''),
            domain=api_sessioninfo.get('domain', ''),
        )

    return api_session


# (connect, read) timeouts for every call to the API. Without these, a hung
# API holds a gunicorn worker forever; four hung requests would take the
# whole map down even though the map itself is healthy.
API_TIMEOUT = (3.05, 10)


class ShareaboutsApiError (Exception):
    def __init__(self, msg, errors):
        super().__init__(msg)
        self.errors = errors


class ShareaboutsApi:
    def __init__(
        self,
        config: _ShareaboutsConfig,
        request: HttpRequest,
        dataset_root: str | None = None,
        sessioninfo: dict | None = None
    ):
        if config is None:
            config = get_shareabouts_config(settings.SHAREABOUTS.get('CONFIG'))
            config.update(settings.SHAREABOUTS.get('CONTEXT', {}))

        if dataset_root is None:
            dataset_root = settings.SHAREABOUTS.get('DATASET_ROOT')

        if (dataset_root.startswith('file:')):
            if not request:
                raise ValueError('A request object is required to use a file-based dataset_root.')
            dataset_root = request.build_absolute_uri(reverse('api_proxy', args=('',)))

        if sessioninfo is None:
            if not request:
                raise ValueError('A request object is required to dynamically get the sessioninfo.')
            sessioninfo = get_api_sessioninfo(request)
            print(f'Got sessioninfo: {sessioninfo}')

        # True when the most recent call could not reach the API or came back
        # with a non-200. Callers that cache results check this so a blip is
        # never stored as a real answer.
        self.last_call_failed = False
        self.config = config
        self.dataset_root = dataset_root
        self.auth_root = make_auth_root(dataset_root)
        self.root = make_api_root(dataset_root)
        self.sessioninfo = sessioninfo
        self.session = make_api_session(dataset_root, sessioninfo)

    def get(self, resource, default=None, **kwargs):
        uri = make_resource_uri(resource, root=self.dataset_root)
        try:
            res = self.session.get(uri, params=kwargs, timeout=API_TIMEOUT)
        except requests.RequestException:
            self.last_call_failed = True
            return default
        self.update_session_cookie()
        if res.status_code != 200:
            # "The API did not answer" and "the answer was empty" are very
            # different things to a caller that caches the result — flag it
            # so they can tell the two apart.
            self.last_call_failed = True
            return default
        self.last_call_failed = False
        return res.text

    def current_user(self, default=None, **kwargs):
        if not hasattr(self, '_cached_user'):
            uri = make_resource_uri('current', root=self.auth_root)
            try:
                res = self.session.get(uri, timeout=API_TIMEOUT, **kwargs)
            except requests.RequestException:
                # Do NOT remember this as an answer: a blip must not read as
                # "nobody is signed in".
                self.last_call_failed = True
                return default
            self.update_session_cookie()
            if res.status_code != 200:
                self.last_call_failed = True
                return default
            self.last_call_failed = False
            self._cache_user(res.json())
        return self._cached_user

    def login(self, username, password, **kwargs):
        payload = {
            'username': username,
            'password': password,
        }
        uri = make_resource_uri('current', root=self.auth_root)
        try:
            res = self.session.post(uri, json=payload, timeout=API_TIMEOUT, **kwargs)
        except requests.RequestException:
            raise ShareaboutsApiError(
                'Could not reach the server',
                {'network': 'Could not reach the server. Please try again.'})
        self.update_session_cookie()

        if res.status_code == 200:
            self._cache_user(res.json())
            return True
        else:
            try:
                errors = res.json().get('errors')
            except ValueError:
                errors = None
            raise ShareaboutsApiError(res.text, errors)

    def qr_login(self, token, **kwargs):
        """
        Start an API session from a QR login card secret. Returns True on
        success; any failure (bad card, network trouble) is just False.
        """
        uri = make_resource_uri('qr-session', root=self.auth_root)
        try:
            res = self.session.post(uri, json={'token': token}, timeout=API_TIMEOUT, **kwargs)
        except requests.RequestException:
            return False
        self.update_session_cookie()
        return res.status_code == 204

    def logout(self, **kwargs):
        uri = make_resource_uri('current', root=self.auth_root)
        try:
            res = self.session.delete(uri, timeout=API_TIMEOUT, **kwargs)
        except requests.RequestException:
            raise ShareaboutsApiError(
                'Could not reach the server',
                {'network': 'Could not reach the server. Please try again.'})
        self.update_session_cookie()

        if res.status_code == 204:
            self._cache_user(None)
            return True
        else:
            raise ShareaboutsApiError(res.text, {})

    def update_session_cookie(self):
        """
        Update the sessionid from the cookies in the session.
        """
        for cookie in self.session.cookies:
            if cookie.name == 'sessionid':
                self.sessioninfo = {
                    'id': cookie.value,
                    'domain': cookie.domain,
                }
                break
        else:
            self.sessioninfo = None

    def _cache_user(self, user):
        self._cached_user = user

    def _invalidate_user(self):
        del self._cached_user

    def respond_with_session_cookie(self, response: HttpResponse):
        if self.sessioninfo:
            response.set_cookie('sa-api-sessionid', self.sessioninfo['id'])
            response.set_cookie('sa-api-sessiondomain', self.sessioninfo['domain'])
            print(f'Updating session cookie: {self.sessioninfo}')
        else:
            response.delete_cookie('sa-api-sessionid')
            response.delete_cookie('sa-api-sessiondomain')
            print('Deleting session cookie')
        return response
