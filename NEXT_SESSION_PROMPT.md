# Paste this whole file into a new Claude session

Working folder: /Users/satishmallahsahani/shareabouts
API repo if needed: /Users/satishmallahsahani/shareabouts-api

Read CLAUDE_BRIEF.md first — deploy rules. Never rsync config files, never
expose ports, ask me before any deploy or API/database change.
Then read ACCOUNTS_PLAN.md for the product plan and verified facts.

STATE (8 Aug 2026, branch google-login-fix, all committed):

- DONE: P1 usernames on listings; P10 session fix (400 days); P4 SECRET_KEY
  out of settings.py (dev key in Mac's gitignored local_settings.py);
  Add-button gated behind login with welcome for viewers; Directions
  full-width bar (P5); §6 speed fixes (timeouts in sa_util/api.py AND
  proxy_view in sa_web/views.py, 60s current_user session cache);
  §8 sign-in as a PANEL over the running map at /page/signin (flavor
  templates signin.html, auth-nav.html, pages-nav-item.html with hidden:
  flag, config pages entry, custom.js + base.html include);
  §9 piece 1 (required stay_duration select now/3m/6m/1y/2y/3y in
  config.yml with live "Free from ..." preview).
- NOT DONE: §9 piece 2 (panel shows "Available now" / "Free from <date>"
  computed from created date + stay_duration) and piece 3 (marker colors:
  green available, gray not yet, gold Yours for owner, normal for dateless);
  gunicorn gthread workers (Procfile + Dockerfile CMD still plain -w 4);
  §8 note: failed login still lands on the old /login/ page with the error;
  §0 GitHub backup (gh CLI not installed; owner gave permission, needs
  brew install gh + owner clicking authorize); nightly DB dump.

DECISIONS ALREADY TAKEN (do not re-ask):

- Store NO separate date: availability = place created date + stay_duration,
  computed on every read. "now" = available immediately.
- Map markers: COLOR ONLY (green/gray), words only in the clicked panel:
  "Available now" / "Free from 8 Nov 2026". Never "Packed"/"Occupied".
- English dates for now, Nepali (Bikram Sambat) maybe later.
- Accounts only created by owner in API Django admin; no self-signup;
  viewers need no login; "Get an account" → contact page (swap to wa.me
  when owner provides the WhatsApp number). College accounts free.
- Photos on listings: postponed.

HARD-WON TECHNICAL FACTS (verified this session):

- NEVER put <script> tags inside jstemplates — base.html embeds compiled
  templates inline via {% handlebarsjs %}, and a literal </script> cuts the
  block and breaks ALL templates. Flavor JS goes in
  src/flavors/satish/static/js/custom.js (loaded from base.html).
- Local Docker review: the Mac's local_settings.py points DATASET_ROOT at
  localhost:8000, which inside the map container is the container itself
  (self-deadlock, 30s hangs). Run the container with a mounted override
  that swaps localhost -> host.docker.internal, e.g. the file
  local_settings_docker.py (copy of local_settings.py with that one edit),
  mounted read-only at /app/src/project/local_settings.py. Start the local
  API first: cd ~/shareabouts-api && docker compose start (NOT up, up tries
  to re-pull). Local test login: kothatest / kotha-review-2026 (exists only
  in the local practice database).
- The header Sign In link must NOT use id="sign-in-btn" (that id is wired
  to a dropdown toggle); the flavor auth-nav.html uses class sign-in-link.
- Panel pages: config pages entries with hidden: true stay out of the nav
  (flavor pages-nav-item.html supports it); /page/<slug> routes client-side
  and keeps the map alive behind the panel.

WARNINGS:

- Before deploying: server MUST have SECRET_KEY in
  /opt/shareabouts/src/project/local_settings.py or the site will not
  start. Not yet verified (ssh needs the owner's password). Also note the
  new key invalidates old anonymous sessions (their delete buttons vanish).
- The code has NO backup outside this Mac yet.
- The owner does not read the .md plans — explain in simple words, one
  small piece at a time, upper view first, and ask before each piece.
  Owner reviews at http://127.0.0.1:8080 in their own browser.
