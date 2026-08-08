# KothaKhoj — Project Brief for Claude

Paste this whole file at the start of a new chat before asking for changes.

## What this is
KothaKhoj is a rental-room map for Butwal, Nepal, built on the open-source
Shareabouts platform (GPL v3). Two Django apps run in Docker:
- **shareabouts** (the MAP app) — what users see at kothakhoj.com
- **shareabouts-api** (the API) — stores data, at api.kothakhoj.com

All my customizations live in `src/flavors/satish/`.

## Where things run
- **My Mac:** `~/shareabouts` and `~/shareabouts-api` (the code, in git)
- **Server:** DigitalOcean droplet, `ssh root@165.232.180.13`, code in
  `/opt/shareabouts` and `/opt/shareabouts-api`
- **Cloudflare** sits in front (DNS + CDN + HTTPS edge). **Caddy** on the server
  gives HTTPS. Domains: `kothakhoj.com` (map) and `api.kothakhoj.com` (API).

## HARD RULES — these caused every outage we ever had

### Deploy rule 1: NEVER rsync config files
These differ between my Mac and the server. Copying the Mac versions over the
server BROKE the site twice (Internal Server Error) and once REOPENED the
database to the internet (which got it hacked). Always deploy with excludes:

```
# MAP app
rsync -av --exclude env --exclude .git --exclude node_modules \
      --exclude 'local_settings.py' \
      ~/shareabouts root@165.232.180.13:/opt/

# API app
rsync -av --exclude env --exclude .git \
      --exclude '.env' --exclude 'compose.yml' \
      ~/shareabouts-api root@165.232.180.13:/opt/
```

Protected server files (never overwrite): `src/project/local_settings.py`
(map), `.env` and `compose.yml` (API).

### Deploy rule 2: rebuild after uploading
```
# API (only if API changed):
cd /opt/shareabouts-api && docker compose up -d --build

# MAP:
cd /opt/shareabouts && docker build --build-arg SHAREABOUTS_FLAVOR=satish \
  -t kothakhoj-map . && docker rm -f kothakhoj-map && \
  docker run -d --restart always --name kothakhoj-map \
  -p 127.0.0.1:8080:8000 kothakhoj-map
```

### Security rule: every port must be bound to 127.0.0.1
After any API deploy, check:
```
docker ps --format "table {{.Names}}\t{{.Ports}}"
```
Every published port MUST show `127.0.0.1:` in front. A database exposed to the
internet with a weak password got this project hacked once. Never expose db
(5432/15432) or redis (6379/16379). Note: the ufw firewall does NOT cover
Docker-published ports, so this binding is the real protection.

### Secrets: never in git, never default
DB password, Django SECRET_KEYs, admin password, API keys live only in the
server's `.env` / `local_settings.py`. Never use `postgres` or any default.

## How to verify after a deploy
```
curl -I -m 10 http://127.0.0.1:8080                 # map -> expect 200/302
curl -s -m 10 -H "Host: api.kothakhoj.com" \
  http://127.0.0.1:8000/api/v2/demo-user/datasets/demo-data | head -c 150
```

## When a change "doesn't work"
SUSPECT BROWSER CACHE FIRST. Hard-refresh (Cmd+Shift+R) or use a private
window before assuming the code is wrong. Safari caches JS aggressively and
blocks geolocation on http:// — test location/directions features in Chrome
locally, they only work over HTTPS.

## My workflow
1. Edit code on the Mac, test at `http://127.0.0.1:8080` (Chrome).
2. `git add -A && git commit -m "..."` after each working step.
3. Deploy with the exact excludes above, rebuild, verify ports + curl.

## Known facts
- DATASET (server): owner `demo-user`, slug `demo-data`.
- Flavor build arg: `SHAREABOUTS_FLAVOR=satish`.
- Data lives in a Docker volume; `docker compose down -v` DELETES it — use
  `stop`/`start`, never `down -v`, unless wiping on purpose.
- DigitalOcean backups: keep them ENABLED.
- Google/Facebook login is NOT working (cross-domain session issue) — a plan
  exists in GOOGLE_LOGIN_PLAN.md; treat it as a careful, separate task.

## Ask me before doing any of these
- Anything touching the API container or database
- Any deploy command (so I can confirm the excludes are present)
- Any change to compose.yml, .env, local_settings.py, or ports
