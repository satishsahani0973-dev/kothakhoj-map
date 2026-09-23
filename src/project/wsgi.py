"""
WSGI config for project project.

This module contains the WSGI application used by Django's development server
and any production WSGI deployments. It should expose a module-level variable
named ``application``. Django's ``runserver`` and ``runfcgi`` commands discover
this application via the ``WSGI_APPLICATION`` setting.

Usually you will have the standard Django WSGI application here, but it also
might make sense to replace the whole Django WSGI application with a custom one
that later delegates to the Django one. For example, you could introduce WSGI
middleware here, or combine a Django application with an application of another
framework.

"""
import os
import sys

projectdir = os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
sys.path.insert(0, projectdir)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "project.settings")

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()

from dj_static import Cling
application = Cling(application)

from .gzip_middleware import GzipMiddleware
application = GzipMiddleware(application)

from .twinkie import ExpiresMiddleware
# A year on every static asset. Every one of these is either content-hashed by
# ManifestStaticFilesStorage or a file whose contents never change, so a long
# life is safe and a short one is pure waste.
#
# Keys are matched against Content-Type EXACTLY. That is why the list looks
# redundant: python's mimetypes table answers 'text/javascript' for .js from
# 3.11 on and 'application/javascript' before it, so both have to be here or
# the answer changes silently on a python bump. Missing 'text/javascript' is
# what left every .js on Cloudflare's 4-hour default - roughly 161KB
# re-downloaded by every returning visitor, several times a day.
#
# Do NOT replace this with the '*' wildcard twinkie supports. Despite its
# docstring this middleware does not check the path; it wraps every response,
# including Django's HTML. A wildcard would freeze the pages themselves for a
# year and nobody would ever see a deploy again.
YEAR = 365*24*60*60
application = ExpiresMiddleware(application, {
    # scripts - both spellings, see above
    'application/javascript':     YEAR,
    'text/javascript':            YEAR,
    # styles
    'text/css':                   YEAR,
    # fonts. woff2 was missing, so the self-hosted wordmark was revalidating
    # on every visit - worse than the fonts.gstatic copy it replaced.
    'font/woff2':                 YEAR,
    'font/woff':                  YEAR,
    'font/ttf':                   YEAR,
    'application/font-woff':      YEAR,
    # images
    'image/png':                  YEAR,
    'image/jpeg':                 YEAR,
    'image/gif':                  YEAR,
    'image/webp':                 YEAR,
    'image/svg+xml':              YEAR,
    'image/vnd.microsoft.icon':   YEAR,
    'image/x-icon':               YEAR,
})

from .basic_auth import BasicAuthMiddleware
application = BasicAuthMiddleware(application, exempt=(
    r'^/api/',
))
