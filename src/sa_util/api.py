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


# Cookie values that mean "there is no session here". The first two are what
# this code used to write: a visitor with no session got the *string* 'None'
# stored in their browser, because a missing id was handed to requests, which
# stringified it. They are treated as absent on the way IN as well as refused
# on the way out, so a browser already holding the bad value recovers by
# itself on the next page load instead of staying signed out forever.
NOT_A_SESSION = frozenset(['', 'none', 'null', 'undefined'])


def _real_cookie_value(value):
    """
    A cookie value, or None when it is absent or one of the words that mean
    absent. Compared case-insensitively: the id came out as 'None' and the
    domain as 'none'.
    """
    if value is None:
        return None
    value = value.strip()
    return None if value.lower() in NOT_A_SESSION else value


def get_api_sessioninfo(django_http_request: HttpRequest) -> ApiSessionInfo:
    """
    Pull session cookie information from a Django HTTP request, or None when
    the request carries no session.

    Returning None rather than a dict of Nones matters: every caller tests
    this value for truth, and a dict with nothing in it is still truthy. That
    is how a visitor with no session ended up with a cookie jar entry named
    'sessionid' whose value was the text 'None' scoped to the domain 'none' -
    which was then written back to the browser as a real-looking session and
    sent to the API on every later request, where it meant nothing. The API
    saw an anonymous caller, the map saw a signed-out user, and the Delete
    button vanished from people's own rooms.
    """
    session_id = _real_cookie_value(
        django_http_request.COOKIES.get('sa-api-sessionid'))
    if not session_id:
        return None
    return {
        'id': session_id,
        'domain': _real_cookie_value(
            django_http_request.COOKIES.get('sa-api-sessiondomain')),
    }


def make_api_session(dataset_root, api_sessioninfo: ApiSessionInfo):
    """
    Create a requests session for the Shareabouts API.
    """
    api_session = requests.Session()
    api_session.headers['Content-type'] = 'application/json'
    api_session.headers['Accept'] = 'application/json'

    # Only ever carry a session we actually have. get_api_sessioninfo returns
    # None when there is none, and an id is required here besides, so that a
    # half-filled dict can never put a placeholder in the jar again.
    if api_sessioninfo and api_sessioninfo.get('id'):
        api_session.cookies.set(
            'sessionid',
            api_sessioninfo['id'],
            domain=api_sessioninfo.get('domain') or '',
        )

    return api_session


# (connect, read) timeouts for every call to the API. Without these, a hung
# API holds a gunicorn worker forever; four hung requests would take the
# whole map down even though the map itself is healthy.
API_TIMEOUT = (3.05, 10)


class ShareaboutsApiError (Exception):
    def __init__(self, msg, errors, status=None):
        super().__init__(msg)
        self.errors = errors
        # The API's own status code, where there was one. The sign-in panel
        # needs to tell a wrong password (401) apart from "too many wrong
        # passwords, wait a few minutes" (429) - without this every failure
        # looked identical to the person typing, so someone who had hit the
        # limit just kept trying and being told their password was wrong.
        self.status = status


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
            raise ShareaboutsApiError(res.text, errors, status=res.status_code)

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
            # A jar entry whose value is the text 'None' is not a session; see
            # NOT_A_SESSION. Skipping it here means the delete branch below
            # runs instead, which is the truthful answer.
            if cookie.name == 'sessionid' and _real_cookie_value(cookie.value):
                self.sessioninfo = {
                    'id': cookie.value,
                    'domain': _real_cookie_value(cookie.domain),
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
            # These two are set by hand rather than by Django's session
            # machinery, so SESSION_COOKIE_SECURE does not reach them and they
            # went out with no flags at all. sa-api-sessionid IS the API
            # session - whoever holds it is signed in as that account.
            #
            # httponly because nothing in the browser reads either of them:
            # they are sent straight back to this server, which forwards them
            # to the API (sa_web/views.py reads them from request.COOKIES).
            # samesite Lax matches what browsers already assume when the
            # attribute is absent, written down so it cannot drift.
            #
            # max_age, because without it this went out as a browser-session
            # cookie: closing Chrome threw the sign-in away. The map's own
            # session lasts 400 days and the API keeps its session for the
            # same, but the browser was dropping the key that joins the two -
            # so someone came back the next day silently signed out, with the
            # Delete button gone from their own room while the gold "Yours"
            # pin (which lives in localStorage) still said it was theirs.
            # 400 days is not a preference: browsers cap cookie lifetime
            # there and silently shorten anything longer.
            cookie_flags = {
                'secure': settings.SESSION_COOKIE_SECURE,
                'httponly': True,
                'samesite': 'Lax',
                'max_age': settings.SESSION_COOKIE_AGE,
            }
            response.set_cookie('sa-api-sessionid', self.sessioninfo['id'], **cookie_flags)
            # Only write a domain we actually have. Handing None to set_cookie
            # is what put the text 'none' in the browser in the first place,
            # and requests then scoped the session to a domain that matches
            # nothing, so it was never sent to the API at all.
            domain = self.sessioninfo.get('domain')
            if domain:
                response.set_cookie('sa-api-sessiondomain', domain, **cookie_flags)
            else:
                response.delete_cookie('sa-api-sessiondomain', samesite='Lax')
            # The id is a credential - whoever holds it is signed in as that
            # account - so it is not printed. The old line put it in the
            # container log on every request. Say only that there is one.
            print('Session cookie written (domain set: %s)' % bool(domain))
        else:
            # Delete with the same samesite the set branch uses. A cookie is
            # identified by name, domain and path, so this clears it either
            # way, but matching attributes keeps browsers from warning and
            # stops the two branches drifting apart later. Django works out
            # `secure` for a deletion itself and takes no argument for it.
            response.delete_cookie('sa-api-sessionid', samesite='Lax')
            response.delete_cookie('sa-api-sessiondomain', samesite='Lax')
            print('Deleting session cookie')
        return response
