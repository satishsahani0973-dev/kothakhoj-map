import dateutil.parser
import ujson as json
import logging
import os
import posixpath
import re
import requests
import time
import hashlib

from sa_util.api import make_auth_root, make_resource_uri, ShareaboutsApi
from sa_util.config import get_shareabouts_config
from django.shortcuts import render
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMultiAlternatives
from django.http import HttpRequest, HttpResponse, Http404
from django.template import TemplateDoesNotExist
from django.template.loader import render_to_string
from django.utils import translation
from django.utils.timezone import now, make_aware
from django.utils.translation import (
    LANGUAGE_SESSION_KEY, check_for_language, get_language,
)
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from django.views.i18n import LANGUAGE_QUERY_PARAMETER
from django.urls import resolve
from proxy.views import proxy_view as remote_proxy_view

log = logging.getLogger(__name__)


def calc_adding_support(adding_supported):
    if isinstance(adding_supported, dict):
        # Get the first list item. If there is no list item, then adding is not
        # supported.
        try:
            start = adding_supported['from']
        except KeyError:
            return False

        # Try to parse the start time. If now is before the start time then
        # adding is not supported.
        if dateutil.parser.parse(start) > now():
            return False

        # Get the next list item. If there is no next list item, then the
        # adding period never ends and adding is supported.
        try:
            end = adding_supported['until']
        except KeyError:
            return True

        # Try to parse the end time. If now is before the end time then adding
        # is supported.
        if dateutil.parser.parse(end) > now():
            return True

        return False

    else:
        return adding_supported


def apply_language(viewfunc):
    def view_wrapper(request: HttpRequest, *args, **kwargs) -> HttpResponse:
        """
        Use the code from the django.views.i18n.set_language view to update the language
        in response to a GET request.

        Use as a decorator around a view function.
        """
        lang_code = request.GET.get(LANGUAGE_QUERY_PARAMETER)
        if not (lang_code and check_for_language(lang_code)):
            return viewfunc(request, *args, **kwargs)

        # Because we don't have a language cookie set yet, we need to activate the
        # language, as would normally happen in django.middleware.locale.LocaleMiddleware.
        translation.activate(lang_code)
        request.LANGUAGE_CODE = get_language()

        if hasattr(request, 'session'):
            # Storing the language in the session is deprecated.
            # (RemovedInDjango40Warning)
            request.session[LANGUAGE_SESSION_KEY] = lang_code

        response = viewfunc(request, *args, **kwargs)

        # Finally, set the language cookie so that future requests will have the
        # language set.
        response.set_cookie(
            settings.LANGUAGE_COOKIE_NAME, lang_code,
            max_age=settings.LANGUAGE_COOKIE_AGE,
            path=settings.LANGUAGE_COOKIE_PATH,
            domain=settings.LANGUAGE_COOKIE_DOMAIN,
            secure=settings.LANGUAGE_COOKIE_SECURE,
            httponly=settings.LANGUAGE_COOKIE_HTTPONLY,
            samesite=settings.LANGUAGE_COOKIE_SAMESITE,
        )
        return response
    return view_wrapper


# How long a page load may reuse the last "who is this session" answer from
# the API. index() runs for every visitor on every page, so without this
# every single page view is a blocking round trip to the API. The cache is
# keyed by the API session cookie, so logging in or out (which changes that
# cookie) refreshes it immediately.
API_USER_CACHE_SECONDS = 60


def get_cached_api_user(request, api):
    sessionid = (api.sessioninfo or {}).get('id')
    cached = request.session.get('api_user_cache')
    if (cached
            and cached.get('sid') == sessionid
            and time.time() - cached.get('ts', 0) < API_USER_CACHE_SECONDS):
        return cached.get('user')
    user = api.current_user(default=None)
    if getattr(api, 'last_call_failed', False):
        # The API did not answer. Never write that down as "signed out", or a
        # one-second blip logs a poster out of the UI for a full minute and
        # takes the Delete button off their own rooms. Reuse the last known
        # answer for this session instead.
        if cached and cached.get('sid') == sessionid:
            return cached.get('user')
        return user
    request.session['api_user_cache'] = {
        'sid': sessionid, 'user': user, 'ts': time.time()}
    return user


@ensure_csrf_cookie
@apply_language
def index(request, place_id=None):
    config = get_shareabouts_config()
    api = ShareaboutsApi(config, request)

    go_live_date = config.get('app', {}).get('go_live_date')
    if go_live_date:
        try:
            go_live_date = dateutil.parser.parse(go_live_date)
        except Exception as e:
            raise ImproperlyConfigured(f'Invalid go_live_date: {go_live_date} -- {e}')

        # Make the go_live_date timezone-aware if it's not already.
        if not go_live_date.tzinfo:
            go_live_date = make_aware(go_live_date)

        if go_live_date > now():
            return render(request, 'prelaunch.html', {'config': config, 'go_live_date': go_live_date})

    # Get the content of the static pages linked in the menu.
    pages_config = config.get('pages', [])
    pages_config_json = json.dumps(pages_config)

    # Set the map adding enabled statuses
    place_config = config.get('place', {})
    survey_config = config.get('survey', {})
    support_config = config.get('support', {})

    place_config['adding_supported'] = calc_adding_support(place_config.get('adding_supported'))
    survey_config['adding_supported'] = calc_adding_support(survey_config.get('adding_supported'))
    support_config['adding_supported'] = calc_adding_support(support_config.get('adding_supported'))

    # The user token will be a pair, with the first element being the type
    # of identification, and the second being an identifier. It could be
    # 'username:mjumbewu' or 'ip:123.231.132.213', etc.  If the user is
    # unauthenticated, the token will be session-based.
    if 'user_token' not in request.session:
        t = int(time.time() * 1000)
        ip = request.META['REMOTE_ADDR']
        unique_string = (str(t) + str(ip)).encode()
        session_token = 'session:' + hashlib.md5(unique_string).hexdigest()
        request.session['user_token'] = session_token

    # None means "use SESSION_COOKIE_AGE". This must run on every request, not
    # just when the token is first assigned: sessions issued before this fix
    # carry _session_expiry: 0 ("expire on browser close") inside the signed
    # cookie, and only an explicit set_expiry(None) clears it.
    request.session.set_expiry(None)

    user_token_json = u'"{0}"'.format(request.session['user_token'])

    place = None
    if place_id and place_id != 'new':
        place = api.get('places/' + place_id)
        if place:
            place = json.loads(place)

    try:
        uses_mapbox_layers = 'mapbox' in {layer['type'] for layer in config['map']['layers']}
    except KeyError:
        uses_mapbox_layers = False

    context = {'config': config,

               'user_token_json': user_token_json,
               'pages_config': pages_config,
               'pages_config_json': pages_config_json,
               # Useful for customized meta tags
               'place': place,

               'API_ROOT': api.root,
               'DATASET_ROOT': api.dataset_root,

               'api_user': get_cached_api_user(request, api),
               'uses_mapbox_layers': uses_mapbox_layers,
               }

    return api.respond_with_session_cookie(render(request, 'index.html', context))


def normalized_api_path(path):
    """
    One canonical spelling of a proxied API path.

    'places', '/places', '//places', './places' and 'places/../places' all
    end up at the same API endpoint, because make_resource_uri() strips
    leading slashes and the API's router resolves the rest. Any routing or
    permission decision here therefore has to be made on the normalized
    form, or it can be stepped around with an extra slash.
    """
    return posixpath.normpath('/' + path.lstrip('/')).lstrip('/')


# The API serves place creation from the collection endpoint, which also
# accepts a comma-separated id list ('places/1,2') and still creates on
# POST, so both spellings have to be recognised as "add a place".
PLACE_COLLECTION_RE = re.compile(r'^places(?:/(?:\d+,)+\d+)?$')


def has_signed_in_session(request):
    """
    Whether this request carries a session belonging to a real account.

    The 'sa-api-sessionid' cookie is supplied by the client, so its mere
    presence proves nothing — anyone can invent a value. Only the API can
    say whether the session maps to a user, so ask it.
    """
    if not request.COOKIES.get('sa-api-sessionid'):
        return False
    try:
        api = ShareaboutsApi(get_shareabouts_config(), request)
        user = api.current_user()
    except Exception:
        log.exception('Could not verify the API session while adding a place')
        return False
    return bool(user and user.get('username'))


def place_was_created(request, path, response):
    path = normalized_api_path(path)
    return (
        PLACE_COLLECTION_RE.match(path) is not None and
        response.status_code == 201)


def send_place_created_notifications(request, response):
    config = get_shareabouts_config(settings.SHAREABOUTS.get('CONFIG'))

    # Before we start, check whether we're configured to send at all on new
    # place.
    should_send = config.get('notifications', {}).get('on_new_place', False)
    if not should_send:
        return

    # First, check that we have all the settings and data we need. Do not bail
    # after each error, so that we can report on all the validation problems
    # at once.
    errors = []

    try:
        # The request has any potentially private data fields, so we want to be
        # careful about what we include from it in the notification email.
        requested_place = json.loads(request.body)
    except ValueError:
        errors.append('Received invalid place JSON from request: %r' % (request.body,))

    try:
        # The response has things like ID and cretated datetime, which may be
        # useful in the notification email.
        try: response.render()
        except: pass
        place = json.loads(response.content)
    except ValueError:
        errors.append('Received invalid place JSON from response: %r' % (response.content,))

    try:
        from_email = settings.EMAIL_ADDRESS
    except AttributeError:
        errors.append('EMAIL_ADDRESS setting must be configured in order to send notification emails.')

    try:
        email_field = config.get('notifications', {}).get('submitter_email_field', 'submitter_email')
        recipient_email = requested_place['properties'][email_field]
    except KeyError:
        errors.append('No "%s" field found on the place. Be sure to configure the "notifications.submitter_email_field" property if necessary.' % (email_field,))

    # Bail if any errors were found. Send all errors to the logs and otherwise
    # fail silently.
    if errors:
        for error_msg in errors:
            log.error(error_msg)
        return

    # If the user didn't provide an email address, then no need to go further.
    if not recipient_email:
        return

    # Set optional values
    bcc_list = getattr(settings, 'EMAIL_NOTIFICATIONS_BCC', [])

    # If we didn't find any errors, then render the email and send.
    context_data = {
        'place': place,
        'email': recipient_email,
        'config': config,
        'site_root': request.build_absolute_uri('/'),
    }
    subject = render_to_string('new_place_email_subject.txt', context_data, request)
    body = render_to_string('new_place_email_body.txt', context_data, request)

    try:
        html_body = render_to_string('new_place_email_body.html', context_data, request)
    except TemplateDoesNotExist:
        html_body = None

    # connection = smtp.EmailBackend(
    #     host=...,
    #     port=...,
    #     username=...,
    #     use_tls=...)

    # NOTE: Django's send_mail function is not able to handle BCC lists, so we
    # must construct the multipart message manually.
    msg = EmailMultiAlternatives(
        subject,
        body,
        from_email,
        to=[recipient_email],
        bcc=bcc_list)#,
        # connection=connection)

    if html_body:
        msg.attach_alternative(html_body, 'text/html')

    msg.send()
    return msg


def proxy_view(request, url, requests_args={}):
    # For full URLs, use a real proxy.
    if url.startswith('http:') or url.startswith('https:'):
        # Never wait on the API forever. Without a timeout a hung upstream
        # pins a sync gunicorn worker until gunicorn kills it at 30s; four
        # such requests take the whole site down.
        requests_args = dict(requests_args)
        requests_args.setdefault('timeout', (3.05, 25))
        try:
            response = remote_proxy_view(request, url, requests_args=requests_args)
        except requests.RequestException:
            return HttpResponse(
                '{"errors": ["The data server did not respond in time. Please try again."]}',
                status=504, content_type='application/json')

        # Cookies will already have been parsed into the response.cookies
        # attribute, so we can remove the Set-Cookie header to avoid
        # duplication.
        response.headers.pop('Set-Cookie', None)

        # Do not pass on csrf cookies from proxied requests.
        if 'csrftoken' in response.cookies:
            del response.cookies['csrftoken']
        
        return response

    # For local paths, use a simpler proxy. If there are headers specified
    # in the requests_args, keep those.
    else:
        match = resolve(url)
        for name, value in requests_args.get('headers', {}).items():
            name = name.upper().replace('-', '_')
            if name not in ('ACCEPT', 'CONTENT_TYPE'):
                name = 'HTTP_' + name
            request.META[name] = value
        return match.func(request, *match.args, **match.kwargs)


def readonly_response(request, data):
    response_string = json.dumps(data)
    content_type = 'application/json'

    if 'callback' in request.GET:
        response_string = '%s(%s);' % (request.GET['callback'], response_string)
        content_type = 'application/javascript'

    return HttpResponse(response_string, content_type=content_type)


def readonly_file_api(request, path, datafilename='data.json'):
    if path.endswith('actions'):
        return readonly_response(request, {
            'results': [],
            'metadata': {
                'length': 0,
                'next': None,
                'previous': None
            },
        })

    with open(datafilename) as datafile:
        data = json.load(datafile)

        try:
            page_size = int(request.GET.get('page_size'))
        except (TypeError, ValueError):
            page_size = 100

        try:
            page = int(request.GET.get('page'))
        except (TypeError, ValueError):
            page = 1

        start = (page - 1) * page_size
        end = page * page_size
        count = len(data['features'])

        if path.endswith('places'):
            return readonly_response(request, {
                'type': 'FeatureCollection',
                'features': data['features'][start:end],
                'metadata': {
                    'length': count,
                    'next': (end < count) or None,
                    'previous': (start > 0) or None,
                    'page': page,
                    'num_pages': count // page_size + (0 if count % page_size == 0 else 1)
                },
            })

        components = path.split('/')

        seen_places = False
        place_id = set_name = submission_id = None

        for component in components:
            if component == 'places':
                seen_places = True
                continue

            if not seen_places:
                continue

            if place_id is None:
                place_id = int(component)
                continue

            if set_name is None:
                set_name = component
                continue

            if submission_id is None:
                submission_id = int(component)

        for feature in data['features']:
            if feature['id'] != place_id:
                continue

            submissions = feature['properties']['submission_sets'].get(set_name, [])

            # If there's a submission_id, then we're getting a submission
            # instance.
            if submission_id:
                for submission in submissions:
                    if submission['id'] != submission_id:
                        continue

                    return readonly_response(request, submission)
                else:
                    raise Http404

            # If there's no submission_id but there's a set_name, then we're
            # getting a list of submissions.
            elif set_name:
                return readonly_response(request, {
                    'results': submissions,
                    'metadata': {
                        'length': len(submissions),
                        'next': None,
                        'previous': None,
                        'page': 1,
                        'num_pages': 1
                    },
                })

            # Otherwise, we're getting a place instance (place lists and actions
            # are covered above).
            else:
                return readonly_response(request, feature)
        else:
            raise Http404


def api(request, path):
    """
    A small proxy for a Shareabouts API server, exposing only
    one configured dataset.
    """
    root = settings.SHAREABOUTS.get('DATASET_ROOT')

    if root.startswith('file://'):
        return readonly_file_api(request, path, datafilename=root[7:])

    api_key = settings.SHAREABOUTS.get('DATASET_KEY')
    api_session_cookie = request.COOKIES.get('sa-api-sessionid')

    # Every routing decision below is made on the normalized path: the raw
    # one can be spelled several ways ('//places', './places') that all
    # reach the same endpoint upstream.
    norm_path = normalized_api_path(path)

    # Only signed-in posters may add a room. The map hides "Add a Place" from
    # visitors, but this proxy attaches the dataset key to every request it
    # forwards, and that key alone satisfies the API's create permission — so
    # without this check anyone could POST a place straight to /api/places.
    # Comments and support stay open to anonymous students by design.
    if request.method == 'POST' and PLACE_COLLECTION_RE.match(norm_path):
        if not has_signed_in_session(request):
            return HttpResponse('Sign in to add a place', status=403)

    # Server-side ownership check for deletes. Signed-in posters own their
    # places by ACCOUNT: when the request carries a logged-in API session,
    # let the API decide (it now enforces submitter ownership), so a poster
    # can delete their own place from any device. For anonymous callers with
    # no API session, keep the legacy browser-token check.
    place_match = re.match(r'^places/(\d+)$', norm_path)
    if request.method == 'DELETE' and place_match:
        # A cookie the caller invented is not a session: verify it, or fall
        # through to the legacy token check rather than waving the request on.
        if not has_signed_in_session(request):
            session_token = request.session.get('user_token')
            owner_token = None
            try:
                lookup = requests.get(
                    make_resource_uri(path, root),
                    headers={'X-Shareabouts-Key': api_key},
                    timeout=10)
                if lookup.status_code == 200:
                    owner_token = (lookup.json().get('properties') or {}).get('user_token')
            except Exception:
                logging.getLogger(__name__).exception('Owner lookup failed during place delete')
                return HttpResponse('Could not verify ownership', status=403)
            if not session_token or not owner_token or owner_token != session_token:
                return HttpResponse('Forbidden', status=403)

    # It doesn't matter what the CSRF token value is, as long as the cookie and
    # header value match.
    api_csrf_token = '1234csrf567token'

    url = make_resource_uri(path, root)
    headers = {'X-SHAREABOUTS-KEY': api_key,
               'X-CSRFTOKEN': api_csrf_token,
               # Always fetch the API's answer uncompressed. proxy_view drops
               # Content-Encoding when it relays the response (it counts as a
               # hop-by-hop header), so if the upstream replies with brotli or
               # zstd — Cloudflare sits in front of api.kothakhoj.com and does
               # exactly that — the browser is handed compressed bytes
               # labelled "application/json" and every API call fails to
               # parse. requests only auto-decodes gzip/deflate, so asking for
               # identity is the reliable choice. Our own GzipMiddleware still
               # compresses the reply on the way out to the browser.
               'Accept-Encoding': 'identity'}
    # Pass the browser's device token through so the API can verify
    # device-bound ownership on shared accounts.
    device_token = request.META.get('HTTP_X_SHAREABOUTS_DEVICE_TOKEN')
    if device_token:
        headers['X-SHAREABOUTS-DEVICE-TOKEN'] = device_token
    cookies = {'sessionid': api_session_cookie,
               'csrftoken': api_csrf_token} \
              if api_session_cookie else {'csrftoken': api_csrf_token}

    # Clear cookies from the current domain, so that they don't interfere with
    # our settings here.
    request.META.pop('HTTP_COOKIE', None)
    response = proxy_view(request, url, requests_args={
        'headers': headers,
        'cookies': cookies
    })

    if place_was_created(request, path, response):
        send_place_created_notifications(request, response)

    return response


def users(request, path):
    """
    A small proxy for a Shareabouts API server, exposing only
    user authentication.
    """
    if settings.SHAREABOUTS.get('DATASET_ROOT').startswith('file://'):
        return readonly_response(request, None)

    root = make_auth_root(settings.SHAREABOUTS.get('DATASET_ROOT'))
    api_key = settings.SHAREABOUTS.get('DATASET_KEY')
    api_session_cookie = request.COOKIES.get('sa-api-session')

    url = make_resource_uri(path, root)
    headers = {'X-Shareabouts-Key': api_key} if api_key else {}
    cookies = {'sessionid': api_session_cookie} if api_session_cookie else {}
    response = proxy_view(request, url, requests_args={
        'headers': headers,
        'allow_redirects': False,
        'cookies': cookies
    })
    return response


def robots_txt(request):
    """
    Plain robots: everything crawlable except the admin and auth plumbing.
    """
    lines = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin/',
        'Disallow: /login/',
        'Disallow: /users/',
        'Disallow: /api/',
        'Disallow: /full-api/',
        'Sitemap: ' + request.build_absolute_uri('/sitemap.xml'),
        '',
    ]
    return HttpResponse('\n'.join(lines), content_type='text/plain')


SITEMAP_CACHE_SECONDS = 60 * 60 * 12
SITEMAP_MAX_PAGES = 10


def sitemap_xml(request):
    """
    Sitemap of the static pages plus every place. Place ids come from the
    API; failures degrade to a static-only sitemap rather than a 500, and
    the result is cached so crawlers don't hammer the API.
    """
    from django.core.cache import cache

    cached = cache.get('sa-sitemap-xml')
    if cached:
        return HttpResponse(cached, content_type='application/xml')

    base = request.build_absolute_uri('/').rstrip('/')
    urls = [(base + '/', None)]

    config = get_shareabouts_config()

    def walk_pages(pages):
        for page in pages or []:
            if page.get('hidden'):
                continue
            if page.get('slug') and not page.get('external'):
                yield page['slug']
            yield from walk_pages(page.get('pages'))

    for slug in walk_pages(config.get('pages', [])):
        urls.append((base + '/page/' + slug, None))

    api = ShareaboutsApi(config, request)
    places_ok = True
    for page_num in range(1, SITEMAP_MAX_PAGES + 1):
        page_text = api.get('places', page_size=500, page=page_num)
        if getattr(api, 'last_call_failed', False):
            # The API blinked. Do not let a room-less sitemap be mistaken for
            # the truth and cached for half a day — Google would stop finding
            # every room page we have.
            places_ok = False
            break
        if not page_text:
            break
        try:
            data = json.loads(page_text)
        except ValueError:
            places_ok = False
            break
        features = data.get('features', [])
        for feature in features:
            place_id = feature.get('id') or feature.get('properties', {}).get('id')
            if place_id is None:
                continue
            lastmod = feature.get('properties', {}).get('updated_datetime')
            urls.append((base + '/place/' + str(place_id), lastmod))
        if not data.get('metadata', {}).get('next'):
            break

    entries = []
    for loc, lastmod in urls:
        entry = '  <url><loc>' + loc + '</loc>'
        if lastmod:
            entry += '<lastmod>' + lastmod[:10] + '</lastmod>'
        entry += '</url>'
        entries.append(entry)

    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
           '\n'.join(entries) +
           '\n</urlset>\n')

    if places_ok:
        cache.set('sa-sitemap-xml', xml, SITEMAP_CACHE_SECONDS)
        # Keep a long-lived copy of the last good sitemap to fall back on.
        cache.set('sa-sitemap-xml-last-good', xml, SITEMAP_CACHE_SECONDS * 14)
    else:
        last_good = cache.get('sa-sitemap-xml-last-good')
        if last_good:
            return HttpResponse(last_good, content_type='application/xml')
        # Nothing better to serve: hand back what we have, but only briefly,
        # so the next crawl retries instead of waiting twelve hours.
        cache.set('sa-sitemap-xml', xml, 120)
    return HttpResponse(xml, content_type='application/xml')


def csv_download(request, path):
    """
    A small proxy for a Shareabouts API server, exposing only
    one configured dataset.
    """
    root = settings.SHAREABOUTS.get('DATASET_ROOT')

    if root.startswith('file://'):
        return readonly_file_api(request, path, datafilename=root[7:])

    api_key = settings.SHAREABOUTS.get('DATASET_KEY')
    api_session_cookie = request.COOKIES.get('sa-api-session')

    url = make_resource_uri(path, root)
    headers = {
        'X-Shareabouts-Key': api_key,
        'ACCEPT': 'text/csv'
    }
    cookies = {'sessionid': api_session_cookie} if api_session_cookie else {}
    return proxy_view(request, url, requests_args={
        'headers': headers,
        'cookies': cookies
    })

    # Send the csv as a timestamped download
    filename = '.'.join([os.path.split(path)[1],
                        now().strftime('%Y%m%d%H%M%S'),
                        'csv'])
    response['Content-disposition'] = 'attachment; filename=' + filename

    return response
