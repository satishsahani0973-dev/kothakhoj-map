# Google Login — Fix Plan (shared subdomain cookie)

Written 26 July 2026, after the cross-domain session investigation.
Run this at the **start** of a session, not the end. Budget ~1 hour.

---

## The problem in one paragraph

`kothakhoj.com` (map) and `api.kothakhoj.com` (API) are separate origins, so a
login session created on one is invisible to the other. Two attempts failed:

- **Option A** — login started *and* finished on the API domain. OAuth worked,
  the user account was created, but the map never knew, so the header kept
  saying "Sign In".
- **Option B** — login routed through the map's proxy. The API still built its
  callback URL from its own hostname, so the flow finished on the API domain
  with a *different* session → `AuthStateForbidden: Wrong state parameter
  given` → HTTP 500.

## The fix

`api.kothakhoj.com` is a **subdomain** of `kothakhoj.com`, so a cookie set with
`Domain=.kothakhoj.com` is readable by both. Let the API set its session cookie
that way, and have the map read it directly. OAuth stays single-origin (as in
Option A, which worked), and the map can finally see the session.

---

## Steps

### 1. API — share the session cookie across subdomains

In `~/shareabouts-api/src/project/settings.py`, near the other session settings:

```python
# The map lives at kothakhoj.com and this API at api.kothakhoj.com. Setting the
# cookie domain to the parent lets both read the same login session.
SESSION_COOKIE_DOMAIN = '.kothakhoj.com'
CSRF_COOKIE_DOMAIN = '.kothakhoj.com'
```

### 2. Map — read the shared cookie

In `~/shareabouts/src/sa_web/views.py`, in **both** the `api()` and `users()`
proxy functions, read the shared cookie first and fall back to the old name:

```python
api_session_cookie = (request.COOKIES.get('sessionid')
                      or request.COOKIES.get('sa-api-sessionid'))
```

Also remove the Set-Cookie capture block added to `users()` on 26 July — the
shared cookie makes that bridge unnecessary.

### 3. Map — point the sign-in links back at the API domain (Option A style)

`src/flavors/satish/jstemplates/auth-nav.html` and `form-field-input.html`:

```
https://api.kothakhoj.com/api/v2/users/login/google-oauth2/?next=https://kothakhoj.com/
https://api.kothakhoj.com/api/v2/users/login/facebook/?next=https://kothakhoj.com/
```

### 4. Google Cloud — redirect URI

Console → Google Auth Platform → Clients → your client. Ensure this URI exists:

```
https://api.kothakhoj.com/api/v2/users/complete/google-oauth2/
```

(The `kothakhoj.com/users/complete/...` one added for Option B can stay or go.)

### 5. Deploy

Mac:

```
cd ~/shareabouts && git add -A && git commit -m "google login via shared subdomain session cookie"
cd ~/shareabouts-api && git add -A && git commit -m "share session cookie across kothakhoj subdomains"

rsync -av --exclude env --exclude .git --exclude node_modules --exclude 'local_settings.py' ~/shareabouts root@165.232.180.13:/opt/
rsync -av --exclude env --exclude .git --exclude '.env' --exclude 'compose.yml' ~/shareabouts-api root@165.232.180.13:/opt/
```

Server (`ssh root@165.232.180.13`):

```
cd /opt/shareabouts-api && docker compose up -d --build
cd /opt/shareabouts && docker build --build-arg SHAREABOUTS_FLAVOR=satish -t kothakhoj-map . && docker rm -f kothakhoj-map && docker run -d --restart always --name kothakhoj-map -p 127.0.0.1:8080:8000 kothakhoj-map
curl -I -m 10 http://127.0.0.1:8080
```

### 6. Test

1. **Clear cookies for kothakhoj.com and api.kothakhoj.com first** — stale
   sessions from tonight's attempts will otherwise confuse the result.
2. kothakhoj.com → hard refresh → SIGN IN → Google → choose account.
3. Expected: back on kothakhoj.com with **your name** in the header.
4. Add a place — it should be attributed to your name, not "Someone".
5. Delete it — should work (the delete check already understands accounts).

### 7. If it fails

```
docker logs kothakhoj-map --tail 40
cd /opt/shareabouts-api && docker compose logs web --tail 40
```

Rollback (site returns to current working state, login dormant):

```
cd ~/shareabouts && git revert --no-edit HEAD
cd ~/shareabouts-api && git revert --no-edit HEAD
# then rsync + rebuild as in step 5
```

---

## Notes

- Login stays **optional** throughout. Anonymous posting continues to work.
- Anonymous places already on the map cannot be claimed retroactively.
- Facebook login needs its own App ID/Secret in the API `.env`
  (`SHAREABOUTS_FACEBOOK_KEY` / `SHAREABOUTS_FACEBOOK_SECRET`) before that
  button works. Google first.
- Fallback if the shared cookie doesn't work: serve the API under a path on the
  same domain (`kothakhoj.com/backend/…` with Django's `FORCE_SCRIPT_NAME`).
  Heavier, but removes the origin problem entirely.
