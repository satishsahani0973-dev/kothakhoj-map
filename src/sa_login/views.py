from django.http import HttpRequest, JsonResponse
from django.shortcuts import render, redirect
from sa_util.config import get_shareabouts_config
from sa_util.api import ShareaboutsApi, ShareaboutsApiError


def logout_view(request: HttpRequest):
    """
    The header Log Out link. Ends the API session and returns to the map.
    (The API has no /users/logout/ route, so the old proxied link 404'd.)
    """
    config = get_shareabouts_config()
    api = ShareaboutsApi(config, request)
    try:
        api.logout()
    except ShareaboutsApiError:
        pass
    return api.respond_with_session_cookie(redirect('/'))


def qr_login(request: HttpRequest, token: str):
    """
    The QR card door: /qr/<secret>. Valid card -> session starts and the
    map opens signed in. Invalid card -> back to the map with a short-lived
    flash cookie that the client shows as an error message.
    """
    config = get_shareabouts_config()
    api = ShareaboutsApi(config, request)

    response = redirect('/')
    if not api.qr_login(token):
        response.set_cookie('qr-error', '1', max_age=60)
    return api.respond_with_session_cookie(response)


def login(request: HttpRequest):
    # Load app config settings
    config = get_shareabouts_config()
    api = ShareaboutsApi(config, request)

    api_user = ''
    error_str = ''

    # GET the current user session from the API
    if request.method == 'GET':
        api_user = api.current_user()
        next_url = request.GET.get('next', None)

    # POST a new user session to log in to the API
    elif request.method == 'POST' and request.POST.get('shadowmethod', '').upper() != 'DELETE':
        print('Logging in...')
        try:
            api.login(request.POST.get('username'), request.POST.get('password'))
            api_user = api.current_user()
            print('Successfully logged in to the API session.')
        except ShareaboutsApiError as exc:
            error_str = f'Login failed. {"; ".join(exc.errors.values()) if exc.errors else "Please try again."}'
            print('Failed to log in to the API session:', exc)
        next_url = request.POST.get('next', None)

    # DELETE the current user session to log out of the API
    elif request.method == 'POST' and request.POST.get('shadowmethod', '').upper() == 'DELETE':
        print('Logging out...')
        try:
            api.logout()
            api_user = api.current_user()
            print('Successfully logged out of the API session.')
        except ShareaboutsApiError as exc:
            error_str = 'Failed to log out. Please try again.'
            print('Failed to log out of the API session:', exc)
        next_url = request.POST.get('next', None)

    # The map's sign-in panel posts in the background: answer yes/no as JSON
    # so a wrong password never forces a full map reload.
    if request.method == 'POST' and request.headers.get('x-requested-with') == 'XMLHttpRequest':
        response = JsonResponse({'ok': bool(api_user)}, status=200 if api_user else 401)
        return api.respond_with_session_cookie(response)

    if api_user and next_url:
        response = redirect(next_url)
        print(f'Redirecting to {next_url}...')
    elif error_str and request.method == 'POST':
        # A failed sign-in goes back to the map, where the sign-in panel
        # shows the problem inline (with a WhatsApp contact) instead of
        # stranding the person on this bare page.
        response = redirect('/')
        response.set_cookie('login-error', '1', max_age=60)
        print('Login failed; redirecting to the map sign-in panel...')
    else:
        response = render(request, 'sa_login.html', {
            'api_user': api_user,
            'errors': error_str,
            'config': config,
            'dataset_root': api.dataset_root,
            'auth_root': api.auth_root,
            'next_url': next_url,
        })
        print('Rendering the login page...')

    return api.respond_with_session_cookie(response)
