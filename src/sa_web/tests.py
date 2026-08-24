"""
This file demonstrates writing tests using the unittest module. These will pass
when you run "manage.py test".

Replace this with more appropriate tests for your application.
"""

from contextlib import contextmanager
from django.conf import settings
from django.test import Client, override_settings, SimpleTestCase
from os.path import abspath, dirname, join as path_join
from pathlib import Path
from threading import Thread
from unittest import mock
from sa_util import config

class SimpleTest(SimpleTestCase):
    def test_basic_addition(self):
        """
        Tests that 1 + 1 always equals 2.
        """
        self.assertEqual(1 + 1, 2)


class ShareaboutsConfigTest (SimpleTestCase):
    def test_apply_env_overrides(self):
        config_data = {
            'prop0': 'a',
            'prop1': 'b',
            'prop2': {
                'prop3': 'c',
                'prop4': 'd'
            },
            'prop5': 'e'
        }

        env_values = {
            # Ignore props that don't start with SHAREABOUTS__
            'SHAREABOUTS_DATASET_KEY': '123',

            # Change an existing top-level property
            'SHAREABOUTS__PROP0': 'f',

            # Change an existing nested property
            'SHAREABOUTS__PROP2__PROP3': 'g',

            # Change an existing top-level prop to one that has nested vals
            'SHAREABOUTS__PROP5__PROP6': 'h',
            'SHAREABOUTS__PROP5__PROP7': 'i',

            # Create a new top-level prop
            'SHAREABOUTS__PROP8': 'j',

            # Add a new nested prop to an existing top-level prop
            'SHAREABOUTS__PROP2__PROP9': 'k',
        }

        env_data = config.apply_env_overrides(config_data, env_values)

        # Ensure the original data is unchanged
        self.assertDictEqual(config_data, {
            'prop0': 'a',
            'prop1': 'b',
            'prop2': {
                'prop3': 'c',
                'prop4': 'd'
            },
            'prop5': 'e'
        })

        # Ensure the new data is as expected
        self.assertDictEqual(env_data, {
            'prop0': 'f',
            'prop1': 'b',
            'prop2': {
                'prop3': 'g',
                'prop4': 'd',
                'prop9': 'k'
            },
            'prop5': {
                'prop6': 'h',
                'prop7': 'i'
            },
            'prop8': 'j'
        })


# """
# Tests to write:
# * simple request with a sample config
#
# """
#
# class StaticFileAPIBackend (TestCase):
#     def test_can_read_places(self):
#         pass
#
#     def test_can_read_submissions(self):
#         pass
#
#
class StubAPIServerThread (Thread):
    def __init__(self, directory: str):
        self.directory = directory
        super().__init__()

    def run(self):
        from http.server import (
            HTTPServer,
            SimpleHTTPRequestHandler,
        )
        from functools import partial

        StubAPIRequestHandler = partial(SimpleHTTPRequestHandler, directory=self.directory)

        server_address = ('', 8001)
        request_handler = StubAPIRequestHandler
        with HTTPServer(server_address, request_handler) as server:
            self.server = server
            server.serve_forever()


@contextmanager
def start_stub_api_server(directory):
    from time import sleep
    from urllib.error import URLError
    from urllib.request import urlopen

    # Start the server
    thread = StubAPIServerThread(str(directory))
    thread.start()

    # Wait until the server is up
    while True:
        try:
            with urlopen('http://localhost:8001/') as response:
                if response.code == 200:
                    break
        except URLError:
            pass
        sleep(0.1)

    try:
        # After the server's up, proceed with the test
        yield thread.server
    finally:
        # Shut the server down and wait for it to be done
        thread.server.shutdown()
        thread.join()


DATA_FIXTURES_DIR = Path(__file__).resolve().parent
APP_DIR = abspath(dirname(__file__))


@override_settings(
    DEBUG=True,
    SHAREABOUTS={
        'DATASET_ROOT': 'http://localhost:8001/',
        'CONFIG': abspath(path_join(APP_DIR, '..', 'flavors', 'defaultflavor'))
    })
class APIServerBackend (SimpleTestCase):
    def test_index(self):
        with start_stub_api_server(DATA_FIXTURES_DIR / 'test_fixtures') as server:
            client = Client()
            response = client.get('/')
            self.assertEqual(response.status_code, 200)

    def test_api_proxy(self):
        with (DATA_FIXTURES_DIR / 'test_fixtures' / 'places').open('rb') as datafile:
            places_data = datafile.read()

        with start_stub_api_server(DATA_FIXTURES_DIR / 'test_fixtures') as server:
            client = Client()
            response = client.get('/api/places')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, places_data)

    # The proxy attaches the dataset key to everything it forwards, and that
    # key alone satisfies the API's create permission — so the sign-in check
    # has to happen here, not only by hiding the button in the browser.
    # Every spelling below reaches the same create endpoint upstream, so the
    # guard has to recognise all of them — an extra slash or a pk-list suffix
    # used to walk straight past it.
    # ('//api/places' is not here: it never reaches this proxy — Django
    #  routes it to the map's index view, so no place can be created.)
    CREATE_PATH_SPELLINGS = (
        '/api/places',
        '/api/places/',
        '/api//places',
        '/api///places',
        '/api/./places',
        '/api/places/../places',
        '/api/places/1,2',
        '/api/places/12,34,56',
    )

    def test_anonymous_cannot_create_a_place(self):
        with start_stub_api_server(DATA_FIXTURES_DIR / 'test_fixtures'):
            client = Client()
            for path in self.CREATE_PATH_SPELLINGS:
                with self.subTest(path=path):
                    response = client.post(path, data='{}',
                                           content_type='application/json')
                    self.assertEqual(response.status_code, 403)

    def test_invented_session_cookie_cannot_create_a_place(self):
        # The cookie is client-supplied; only the API can say whether it
        # belongs to an account. The stub API answers /users/current with
        # 'null', i.e. nobody is signed in.
        with start_stub_api_server(DATA_FIXTURES_DIR / 'test_fixtures'):
            client = Client()
            client.cookies['sa-api-sessionid'] = 'invented-by-the-caller'
            response = client.post('/api/places', data='{}',
                                   content_type='application/json')
            self.assertEqual(response.status_code, 403)

    def test_signed_in_poster_may_create_a_place(self):
        with start_stub_api_server(DATA_FIXTURES_DIR / 'test_fixtures'):
            client = Client()
            client.cookies['sa-api-sessionid'] = 'a-real-session'
            with mock.patch('sa_web.views.has_signed_in_session',
                            return_value=True):
                response = client.post('/api/places', data='{}',
                                       content_type='application/json')
            self.assertNotEqual(response.status_code, 403)

    def test_anonymous_may_still_comment(self):
        with start_stub_api_server(DATA_FIXTURES_DIR / 'test_fixtures'):
            client = Client()
            for path in ('/api/places/1/comments', '/api/places/1/support'):
                with self.subTest(path=path):
                    response = client.post(path, data='{}',
                                           content_type='application/json')
                    self.assertNotEqual(response.status_code, 403)

    def test_normalized_api_path_collapses_equivalent_spellings(self):
        from sa_web.views import normalized_api_path
        for raw in ('places', '/places', '//places', './places',
                    'places/../places'):
            with self.subTest(raw=raw):
                self.assertEqual(normalized_api_path(raw), 'places')
        self.assertEqual(normalized_api_path('places/1,2'), 'places/1,2')
        self.assertEqual(normalized_api_path('places/7/comments'),
                         'places/7/comments')


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    EMAIL_ADDRESS='campaign@city.gov',
    EMAIL_NOTIFICATIONS_BCC=['stakeholder@city.gov'],
)
class PlaceCreatedNotificationTests (SimpleTestCase):
    def test_send_notification(self):
        from sa_web.views import send_place_created_notifications

        mock_request = mock.Mock()
        mock_request.body = '''
            {
                "properties": {
                    "location_type": "test place",
                    "private-submitter_email": "person@gmail.com"
                }
            }
        '''
        mock_request.build_absolute_uri.return_value = 'http://example.com/'

        mock_response = mock.Mock()
        mock_response.content = '''
            {
                "id": 123,
                "properties": {
                    "location_type": "test place",
                }
            }
        '''

        # import pdb; pdb.set_trace()
        with mock.patch('sa_web.views.EmailMultiAlternatives') as MockEmailMultiAlternatives:
            msg = send_place_created_notifications(mock_request, mock_response)
            MockEmailMultiAlternatives.assert_called_once_with(
                'Thanks for submitting a new test place!',
                'Thanks for submitting a new test place!\n\nThe URL for your place is http://example.com/places/123. Share it around.',
                'campaign@city.gov',
                to=['person@gmail.com'],
                bcc=['stakeholder@city.gov'],
            )
            msg.attach_alternative.assert_called_once_with(
                '<p>Thanks for submitting a new test place!</p>\n\n<p>The URL for your place is http://example.com/places/123. Share it around.</p>',
                'text/html',
            )
            msg.send.assert_called_once_with()
