#!/bin/sh
# Deploy the KothaKhoj map to production.
#
#   ./scripts/deploy.sh              deploy the current commit
#   ./scripts/deploy.sh --rollback   put the previous image back
#
# Replaces typing the build and run commands from memory. Root's bash history
# held 11 different `docker build` lines, and the last two did not match: one
# had `docker rm -f` before `docker run`, the other did not, so the second
# would have failed with "name already in use". This script always runs the
# same commands in the same order.
set -eu

SERVER=${SERVER:-root@165.232.180.13}
REMOTE=/opt/shareabouts
IMAGE=kothakhoj-map
CONTAINER=kothakhoj-map
PUBLISH=127.0.0.1:8080:8000
FLAVOR=satish
BRANCH=google-login-fix
PUBLIC_URL=https://kothakhoj.com/

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nFAILED: %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- rollback --
if [ "${1:-}" = "--rollback" ]; then
  say "rolling back to $IMAGE:rollback"
  ssh "$SERVER" "
    set -e
    docker image inspect $IMAGE:rollback >/dev/null 2>&1 || {
      echo 'no rollback image exists'; exit 1; }
    docker rm -f $CONTAINER >/dev/null 2>&1 || true
    docker run -d --restart always --name $CONTAINER -p $PUBLISH $IMAGE:rollback
    docker tag $IMAGE:rollback $IMAGE:latest
  "
  say "rolled back. check $PUBLIC_URL"
  exit 0
fi

# --------------------------------------------------------------- preflight --
# What is deployed should be something you can find again in git. Deploying a
# dirty tree produces a running site whose source exists only on this laptop.
say "preflight"
[ -f Dockerfile ] && [ -d src/flavors/$FLAVOR ] || die "run this from the map repo root"

[ -z "$(git status --porcelain)" ] || {
  git status --short
  die "working tree is dirty - commit or stash first"
}

here=$(git rev-parse --abbrev-ref HEAD)
[ "$here" = "$BRANCH" ] || die "on branch '$here', expected '$BRANCH'"

[ -z "$(git log --oneline @{u}.. 2>/dev/null)" ] ||
  die "you have unpushed commits - push first, so production matches github"

commit=$(git rev-parse --short HEAD)
printf '  branch %s at %s, tree clean, pushed\n' "$BRANCH" "$commit"

printf '\nDeploy %s to %s? [y/N] ' "$commit" "$SERVER"
read -r ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || die "cancelled"

# -------------------------------------------------------------------- sync --
# local_settings.py is NEVER synced. This laptop's copy points DATASET_ROOT at
# http://localhost:8000 and carries dev keys; the server's copy is the real
# one and is not in git. Copying it up would point production at a database
# that does not exist there, and the map would come up empty.
say "syncing files to $REMOTE"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'env' \
  --exclude 'env2' \
  --exclude 'node_modules' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'src/project/local_settings.py' \
  --exclude '.env' \
  ./ "$SERVER:$REMOTE/"

# ------------------------------------------------------------------- build --
# The rollback tag is written BEFORE the build, so it always points at the
# image that was serving traffic a moment ago - not at whatever half-built
# thing this run produces.
say "building and swapping (rollback tag written first)"
ssh "$SERVER" "
  set -e
  cd $REMOTE

  if docker image inspect $IMAGE:latest >/dev/null 2>&1; then
    docker tag $IMAGE:latest $IMAGE:rollback
    echo '  tagged current image as $IMAGE:rollback'
  else
    echo '  no existing image - nothing to roll back to'
  fi

  docker build --build-arg SHAREABOUTS_FLAVOR=$FLAVOR -t $IMAGE:latest .

  docker rm -f $CONTAINER >/dev/null 2>&1 || true
  docker run -d --restart always --name $CONTAINER -p $PUBLISH $IMAGE:latest >/dev/null
  echo '  container replaced'
"

# ------------------------------------------------------------------ verify --
# Checked on the server against the published port, not through Cloudflare,
# so a cached page cannot make a broken deploy look healthy.
say "verifying"
ok=no
i=1
while [ "$i" -le 10 ]; do
  code=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8080/ || echo 000")
  printf '  attempt %s: %s\n' "$i" "$code"
  if [ "$code" = "200" ]; then ok=yes; break; fi
  sleep 3
  i=$((i + 1))
done

if [ "$ok" != "yes" ]; then
  say "NOT SERVING - rolling back automatically"
  ssh "$SERVER" "
    docker rm -f $CONTAINER >/dev/null 2>&1 || true
    docker run -d --restart always --name $CONTAINER -p $PUBLISH $IMAGE:rollback >/dev/null
  "
  die "deploy failed verification and was rolled back. The bad image is still
tagged $IMAGE:latest on the server if you want to inspect it."
fi

# Only now check the public URL. A failure here with a healthy container means
# Caddy or Cloudflare, not this deploy, so it warns rather than rolls back.
public=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$PUBLIC_URL" || echo 000)
printf '  %s -> %s\n' "$PUBLIC_URL" "$public"
[ "$public" = "200" ] || printf '  WARNING: container is healthy but the public URL is not 200.\n  Look at Caddy or Cloudflare, not at this deploy.\n'

say "deployed $commit"
ssh "$SERVER" "docker ps --filter name=$CONTAINER --format '  {{.Names}}  {{.Status}}  restart={{.Label \"x\"}}'; docker inspect -f '  restart policy: {{.HostConfig.RestartPolicy.Name}}' $CONTAINER"
printf '\nTo undo:  ./scripts/deploy.sh --rollback\n'
