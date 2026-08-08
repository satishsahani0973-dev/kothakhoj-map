# KothaKhoj — Accounts, Listings & Availability Plan

Written 7 August 2026, updated 8 August 2026, after reading the code in both
repos. Nothing here has been built yet. Every claim was verified against the
source; file references are `path:line`.

**Read section 0 first, then section 1.** Section 0 is unfinished safety work.
Section 1 defines the product; everything else serves it.

---

## 0. Before anything else — backups and recovery

**Instruction to any model reading this file: check whether the items in this
section are still undone. If they are, say so before starting whatever task you
were given.** These are not features. They are the difference between a bad day
and losing the project.

### The code has no backup

Both repos' `origin` points at the upstream project we forked:

```
origin  https://github.com/openplans/shareabouts.git
origin  https://github.com/openplans/shareabouts-api.git
```

We cannot push there. So every commit — the flavor, directions, My Location, the
session work — **exists only on the Mac.**

The server does not help. The deploy line in CLAUDE_BRIEF.md uses
`--exclude .git`, so `/opt/shareabouts` has current files but no history, no
branches, no commits. Correct for deploying, useless for recovery.

**If the Mac dies, the work is gone.**

**Fix — two private GitHub repos, added as a second remote. Keep `origin`
pointing at openplans so upstream fixes can still be pulled.**

```bash
cd ~/shareabouts && git remote add kothakhoj https://github.com/YOURNAME/kothakhoj-map.git && git push -u kothakhoj --all
cd ~/shareabouts-api && git remote add kothakhoj https://github.com/YOURNAME/kothakhoj-api.git && git push -u kothakhoj --all
```

`SECRET_KEY` is still in the tracked `settings.py` (see P4). Push anyway — a
private repo holding a key we are going to rotate is far safer than no backup.
Fix the key before the repo is ever made public, not before the first push.

### The secrets exist in exactly one place

`src/project/local_settings.py` (map) and `.env` + `compose.yml` (API) live only
on the droplet. They are excluded from rsync and from git — correct, but it means
nothing backs them up.

If the droplet is destroyed we would have the code and the data and still be
unable to start the site, because we would not have the database password or the
`SECRET_KEY` that existing sessions are signed with.

**Fix:** copy their contents into a password manager or an encrypted note, kept
somewhere that is neither the Mac nor the droplet. Ten minutes.

### The database

It lives in a Docker volume on the droplet. DigitalOcean backups are weekly
snapshots, so a failure can cost up to seven days of listings.

**Fix:** a nightly `pg_dump` written off the droplet. Not urgent while the map is
nearly empty; do it before real listings accumulate.

### Recovery playbooks

**Mac lost or stolen**
1. New machine, `git clone` both private repos
2. Restore `local_settings.py` and `.env` from the password manager
3. Working again in under an hour

**Server hacked** — this has happened once before, via a database exposed to the
internet. Do not clean the droplet. Assume everything on it is stolen.
1. Snapshot the compromised droplet for evidence, then take it offline
2. Build a fresh droplet from the git repos
3. **Rotate every secret** — database password, both `SECRET_KEY`s, admin
   password, API keys. The old ones are burned.
4. Restore data from a backup taken *before* the compromise
5. Confirm `docker ps` shows `127.0.0.1:` on every published port

Rebuild rather than clean, because we cannot prove we found everything an
attacker left behind.

**Droplet accidentally deleted**
Same as above without the rotation. Git, plus secrets, plus a data backup.

### Order

1. Private remotes — the most likely failure, and currently unprotected
2. Secrets into a password manager
3. P4 — rotate `SECRET_KEY` and get it out of `settings.py`
4. Nightly database dump, once there are real listings

---

## 1. The product, in one page

The split is **viewer vs poster**, not student vs landlord. A student can be
either. What separates them is whether they are putting a room on the map.

### Three kinds of people

| Person | Account | What they see |
|---|---|---|
| Looking for a room | none — one tap, "I am a student" | the map, and a welcome where **Add a place** would be |
| Posting a room — a landlord, or a student handing over the room they live in | username + password we issue | **Add a place** |
| Us | Django admin on the API | everything |

Viewing is free and needs no credentials. **Posting is paid.**

### Two ways to post a room

1. **Student handover.** A student already living in a room posts it with the
   date they are leaving — year, month, day. The room shows as occupied with the
   free-from date, and flips to available when that date passes. This is the
   feature that makes the map worth checking again next week.

2. **Landlord.** Adds a room and may choose **available now**, in which case it
   is live immediately with no waiting date.

### How someone becomes a poster

No self-signup, ever. They message us on WhatsApp, pay, and we create the account
by hand in the Django admin and send the credentials back. See sections 2 and 3
for exactly what to click and what not to.

### The two states shown on the map

| When | Label |
|---|---|
| Before the leaving date | `Free from 15 Kartik` |
| On or after, or landlord chose "available now" | `Available now` |

Never "Packed", "Occupied", "Taken" or "Not available". `Free from` states the
same fact but gives the student the thing they need — **when they can have it** —
instead of closing a door. Full wording rules in section 9.

### What must stay true

- The map is never blocked. A viewer reaches it with one tap and no form.
- A poster's listings show their username, not "Someone".
- We can remove a poster later without destroying the rooms they posted.

---

## 2. Facts already established (do not re-derive these)

**The map app has no database.**
`src/project/settings.py:19` — `ENGINE: django.db.backends.dummy`. No migrations,
empty `models.py`, databaseless test runner. So there is no user table, no Django
admin, and `@login_required` is meaningless on `kothakhoj.com`.

**Users live on the API.**
`api.kothakhoj.com/admin` → Sa_Api_V2 → Users. Registered at
`~/shareabouts-api/src/sa_api_v2/admin.py:428` using Django's `BaseUserAdmin`,
so the standard Add-user form with password hashing already works. Nothing to build.

**Username/password login already exists and works.**
`src/sa_login/views.py` posts credentials to the API **server-side** and stores the
returned session as a cookie on our own domain (`src/sa_util/api.py:160`).
`/login/` is routed at `src/sa_web/urls.py:11`.
This is why password login does not hit the cross-domain problem that blocks
Google login — the browser never leaves `kothakhoj.com`.

**The pieces for gating the Add button are already shipped.**
- `{{#is_authenticated}}` helper — `src/sa_web/static/js/handlebars-helpers.js:31`
- Add button lives in `src/sa_web/jstemplates/add-places.html`
- Flavor templates override base ones because the flavor package is prepended to
  `INSTALLED_APPS` at `src/project/settings.py:384`
- `api_user` already reaches `Shareabouts.bootstrapped.currentUser` —
  `src/sa_web/templates/base.html:187`
- `this.$addButton` at `src/sa_web/static/js/views/app-view.js:201` is cached but
  never used, so changing that container breaks nothing
- A working server-side gate pattern already exists in `src/sa_admin/views.py:5`

**`username` is already sent to the browser.**
`~/shareabouts-api/src/sa_api_v2/serializers.py:517` — `username` is not in the
serializer's `exclude` list, and both `SimpleUserSerializer` and `UserSerializer`
only add `groups`. So `{{ submitter.username }}` works in templates today.

---

## 3. Problems, and how to solve each

### P1 — Admin-created users show "Someone", not a name

`get_strategy()` at `serializers.py:520` finds no social-auth record for a user we
made by hand, so it falls back to `DefaultUserDataStrategy.extract_full_name()`
(`serializers.py:338`), which returns `''`. Handlebars treats `''` as falsy, so
`src/flavors/satish/jstemplates/place-detail.html:25` walks down to
`submitter_name`, then to `anonymous_name` — "Someone" (`config.yml:182`).

**Decision taken: show the username.**

Change the name chain to `username → typed name → Someone` in three templates.
Two live in `sa_web`, so copy them into the flavor as overrides rather than
editing upstream:

| File | Shows |
|---|---|
| `src/flavors/satish/jstemplates/place-detail.html:25` | the room listing (already a flavor file) |
| `src/sa_web/jstemplates/activity-list-item.html:6` | sidebar activity feed — copy to flavor |
| `src/sa_web/jstemplates/place-detail-survey.html:39` | comments — copy to flavor |

Drop the `submitter.name` branch since we ruled out display names.

Rejected alternative: adding a `User social auths` record per user with
`{"full_name": "..."}`. It needs no deploy, but requires a second admin record for
every landlord and a hand-typed username that can drift.

### P2 — Deleting a user destroys everything they posted

`~/shareabouts-api/src/sa_api_v2/models/core.py:67`:

```python
submitter = models.ForeignKey(User, on_delete=models.CASCADE, ...)
```

`submitter` sits on `SubmittedThing`, the parent of places **and** submissions. So
deleting one user silently removes every room, comment, and attachment they ever
created.

**Rule: never delete a user. Untick `Active` instead.** The account stops working,
every listing stays on the map. The Users list has a `Delete selected users` bulk
action right at the top of the dropdown — do not use it.

To remove specific rooms, go to Places instead. `search_fields` includes
`submitter__username` (`admin.py` `SubmittedThingAdmin`), so searching the username
finds all of that person's rooms. Prefer unticking `visible` — it is in
`list_editable`, so it toggles straight from the list, and it is reversible.

### P3 — A shared account cannot give per-person delete

If 100 people share one username, they cannot be told apart.

`src/sa_web/static/js/utils.js:89` passes if **either** the `user_token` matches
(same account → all 100 match) **or** the place id is in that browser's
`localStorage`. Removing the first check would leave only the browser-local rule,
which breaks whenever someone clears data or switches phone.

Worse, the API never checks the submitter at all. `is_owner()` at
`~/shareabouts-api/src/sa_api_v2/views/base_views.py:136` compares the logged-in
user against the **dataset owner**, not against who posted the place. The
"only the owner can delete" behaviour is a map-side UI convention, not enforced.

**Solution: one account per landlord.** It is the only way to get real per-person
delete, real attribution, and the ability to remove one person without affecting
the other 99.

### P4 — `SECRET_KEY` is hardcoded and committed

`src/project/settings.py:107` has a literal key, and `settings.py` is tracked in
git. Sessions use `signed_cookies` (`settings.py:146`) and place ownership depends
on them, so anyone holding this key can forge a session and claim or delete any
place.

It also means the key would leak if this repo were ever made public.

**Fix, in order:**
1. Read `SECRET_KEY` from the environment or `local_settings.py`, with no default
2. Confirm the server's `local_settings.py` sets a real one:
   `ssh root@165.232.180.13 "grep -c SECRET_KEY /opt/shareabouts/src/project/local_settings.py"`
3. Purge it from git history before the repo goes public

**Do this before issuing any real account.** Hashed passwords are pointless if the
session around them can be forged.

### P5 — Directions is buried

`place-detail.html:13` renders Directions as a `btn-small` next to the title,
competing with Share. Meanwhile the full-width slot below the header sits empty
for everyone except owners — the delete bar is injected there at
`src/sa_web/static/js/views/place-detail-view.js:108`.

**Fix:** promote Directions into that full-width slot. Owners still get their
delete bar in addition.

---

## 4. Order of work

1. **P10 — `set_expiry(0)`.** One line. Makes the existing `SESSION_COOKIE_AGE`
   actually work.
2. **P4 — SECRET_KEY.** Before the first real account is issued.
3. **P1 — username on listings.** Three flavor templates.
4. **Gate the Add button.** One new flavor file, ~10 lines, using
   `{{#is_authenticated}}` around the contents of `add-places.html`.
5. **Section 9 — availability dates.** The core product feature.
6. **Section 8 — the sign-in screen.**
7. **P5 — promote Directions.**
8. **Section 6 — API timeouts and caching.**

Everything except P4 is map-side only: no API change, no database change, no config
file on the server touched. All of them need a `docker build` + rebuild to reach
production. Test at `http://127.0.0.1:8080` in Chrome first — see CLAUDE_BRIEF.md
for the exact deploy commands and excludes.

---

## 5. How to ask a model to do this

Point the model at the folder and let it read the files itself. One task per
session — these are small changes with a risky deploy path, and batching them
makes a failure hard to attribute.

Template:

```
Working folder: /Users/satishmallahsahani/shareabouts
The API repo, when a task needs it: /Users/satishmallahsahani/shareabouts-api

Read these before doing anything, in this order:
  1. CLAUDE_BRIEF.md          — deploy rules and hard constraints
  2. ACCOUNTS_PLAN.md § 0     — unfinished safety work; tell me if still undone
  3. ACCOUNTS_PLAN.md § 1     — what the product is and who pays
  4. ACCOUNTS_PLAN.md § 2     — facts already verified; do not re-derive them
  5. the section named in the task below

TASK: [one numbered item from section 4]

CONSTRAINTS:
- Map app only. Do not touch the API, the database, or any config file.
- Do not deploy. Do not run rsync or docker. Show me the diff and stop.
- Prefer a flavor override in src/flavors/satish/ over editing src/sa_web/.
- The facts in section 2 are already verified — do not re-investigate them,
  but do check the code still matches before editing.

DONE WHEN: [the specific observable result, e.g. "a logged-in user's listing
shows their username; an anonymous listing still shows Someone"]

Tell me honestly if you think the approach in the plan is wrong.
```

Notes on getting good results:

- **Say what already exists.** The facts in section 2 took a full session to
  establish. Without them a fresh model will re-derive them, or worse, assume the
  map app has a database and give a wrong answer.
- **Say what has been rejected and why.** Section 3 records the alternatives we
  turned down. Add to it every time you reject something, otherwise the next
  session proposes it again.
- **State the deploy boundary every time.** It is the one rule that has actually
  caused outages, and no model will infer it.

### On model choice

Opus 5 at default effort is the right fit for this work — small, surgical,
reviewable changes where you stay in the loop. Fable 5's advantage is long
autonomous runs across large codebases, which is the opposite of this plan, and it
costs roughly double.

The one job here that would suit Fable is the dependency modernization this repo
eventually needs — `social.apps.django_app`, `provider.oauth2` and `S3BotoStorage`
in `settings.py` and `backends.py` are all long-dead packages. That is a genuine
multi-day, cross-repo migration, and it may also be the real fix for the Google
login problem in GOOGLE_LOGIN_PLAN.md.

---

## 6. Production performance

### Do we verify the password ourselves?

No. Django hashes on save (`BaseUserAdmin`) and verifies on login. `sa_login/views.py`
posts the credentials to the API and the API compares hashes. We write no
verification code, and we never see or store the plain password.

Identity verification — proving the person really is a landlord — is human
judgement over WhatsApp, not code. See P3.

### Logins are not the bottleneck. Page views are.

`src/sa_web/views.py:171` — the `index` view passes
`'api_user': api.current_user(default=None)` into the template context.

That means **every page load makes a blocking HTTP request to
`api.kothakhoj.com/users/current`** — every visitor, logged in or not, on every
page. Logging in is rare. Loading the map is constant. The concurrency problem is
in the ordinary path, not the login path.

### What actually limits throughput

**Four sync workers.** `Procfile` and `Dockerfile:53` both run
`gunicorn -w 4`. Sync workers handle one request at a time, and each one spends
most of that time waiting on the network round trip to the API.

Rough ceiling: 4 workers ÷ 200 ms per API call ≈ **20 requests/second**, before
anything else is counted. A single classroom of students opening the site together
can saturate that.

**No timeout on API calls.** `src/sa_util/api.py` calls
`self.session.get(uri, params=kwargs)` with no `timeout=`. Python's `requests`
waits forever by default. If the API becomes slow or unreachable, four requests
hang four workers and **the whole map goes down** — even though the map itself is
perfectly healthy. This is the single largest availability risk in the stack.

**Sessions are cheap, at least.** `SESSION_ENGINE = signed_cookies`
(`settings.py:146`) means no database or cache lookup per request. This part is
already fast and should not be changed.

### Fixes, in order of value per effort

1. **Add a timeout to every API call** in `src/sa_util/api.py` — `timeout=(3, 10)`
   or similar, plus handling for the timeout exception. Small change, removes a
   total-outage failure mode. Do this first.
2. **Cache `current_user` per session** for 30–60 seconds. It is called on every
   page load and the answer almost never changes within a browsing session. This
   removes most of the API round trips outright.
3. **Switch to threaded workers** — `gunicorn -w 4 -k gthread --threads 8`. These
   are I/O-bound waits, not CPU work, so threads multiply capacity cheaply without
   more memory. Change `Procfile` and `Dockerfile:53` together.
4. **Let Cloudflare cache the static bundle.** `app.js`, `libs.min.js` and CSS are
   already fingerprinted by `ManifestStaticFilesStorage`, so they are safe to cache
   hard at the edge. Free, and it takes the largest bytes off the droplet entirely.
5. **Raise worker count only after 1–3.** More workers on a small droplet costs
   memory and does not fix a blocking call that never returns.

### P10 — `set_expiry(0)` defeats the one-year session

`src/sa_web/views.py:143` calls `request.session.set_expiry(0)` when it first
assigns an anonymous `user_token`. In Django, `set_expiry(0)` means "expire when
the browser closes", and it is stored **inside the session data** as
`_session_expiry`.

With `SESSION_ENGINE = signed_cookies`, the session data *is* the cookie — so
`_session_expiry: 0` travels with it and keeps applying on every later request.
`SESSION_SAVE_EVERY_REQUEST = True` re-sends the cookie each response, but it
honours the session's own stored expiry.

**Result: `SESSION_COOKIE_AGE = 1 year` (`settings.py:154`) never takes effect.**
Every visitor gets a browser-session cookie instead.

This means the commit "keep sessions for a year so owners can delete their own
places" did not achieve its goal. When a student closes their browser, they get a
new `user_token`, it no longer matches the one stored on their place, and the
delete button disappears — exactly the behaviour that change was meant to fix.
The comment at `views/place-detail-view.js:105` confirms the delete button uses
the strict token match, so the browser-side `localStorage` fallback does not
rescue it.

**Fix:** replace `request.session.set_expiry(0)` with
`request.session.set_expiry(None)`. `None` means "use `SESSION_COOKIE_AGE`", which
is clearer to read later than deleting the line, and it also clears the bad value
from cookies people are already carrying.

Deleting the line outright works for new visitors but leaves `_session_expiry: 0`
in existing cookies, because the line only runs when `user_token` is absent.
`set_expiry(None)` overwrites it.

**Test:** add a place, confirm the delete button appears, fully quit the browser,
reopen and load the place. Delete button still there = fixed.

### How long should the session last?

Two facts that decide this:

**Browsers cap cookie lifetime at 400 days.** Chrome and Safari both clamp
`Set-Cookie` to that. A 5-year or 10-year value is silently truncated — it gives
exactly the same result as 400 days. Writing a larger number only misleads whoever
reads the setting next.

**`SESSION_SAVE_EVERY_REQUEST = True` (`settings.py:155`) refreshes the expiry on
every request** — not just on login. So the clock restarts each time someone opens
the site. A student who visits even once a year never loses their session, and
someone who visits weekly effectively keeps it forever.

**Recommendation:** set `SESSION_COOKIE_AGE = 60 * 60 * 24 * 400` and leave a
comment saying 400 days is the browser ceiling. Combined with the per-request
refresh, that is the longest session the web actually allows.

---

## 7. Prompt for the production/performance work

```
Read CLAUDE_BRIEF.md and ACCOUNTS_PLAN.md, especially section 6.

CONTEXT: kothakhoj.com is live on a single DigitalOcean droplet behind
Cloudflare. Small audience — students in Butwal — but they arrive in bursts.
Budget is tight; this must stay on one droplet.

TASK: [one numbered fix from section 6]

CONSTRAINTS:
- Map app only unless the task says otherwise. Do not touch the API, the
  database, or any config file on the server.
- Do not deploy. Show me the diff and stop.
- Do not add a new service (no separate cache server, no queue, no load
  balancer) without telling me the running cost first.
- Section 6's findings are verified. Do not re-derive them, but check the
  code still matches before editing.

DONE WHEN: [the observable result, e.g. "a hung API cannot hang the map —
the request fails fast with a clear error instead"]

Then tell me:
- what you would improve that I did not ask for, ranked by value per effort
- anything in section 6 you think is wrong, and why
- what will break first as traffic grows, and roughly at what point
```

Ask for the improvements list every time. Most of what is in this file was found
while looking for something else.

---

## 8. The sign-in screen

The existing login page is `src/sa_login/templates/sa_login.html`, reached at
`/login/`. This is the design it should move to.

### Layout — three things, nothing else

```
                KothaKhoj

        [  Continue browsing  ]        <- filled, primary

        ───────── or ─────────

        [ Username            ]
        [ Password            ]
        [      Sign in        ]        <- outline, secondary

        ─────────────────────
        Landlord or college?
        Chat with us to get an account  <- wa.me link
```

No search bar, no listings preview, no lock icons, no "owners only" badge.

### Design rules, and why

1. **`Continue browsing` is the filled button, not `Sign in`.**
   Nearly everyone opening KothaKhoj is a student who wants the map. The
   majority action gets the primary styling.

2. **Never make the majority path require a decision.**
   Browsing should be what happens if the visitor does nothing. Ideally this
   screen does not block the map at all — it opens when someone taps Sign in.

3. **`or` between the options, not two bordered cards.**
   A divider reads "either is fine". Two boxed cards read "study these and
   choose correctly", which is where hesitation starts.

4. **Name who a feature is for, never who it excludes.**
   "Landlord or college?" invites the right person and lets a student skip it.
   "Accounts are issued by KothaKhoj — contact us" tells a student there is a
   room they cannot enter. Same placement, opposite feeling. Do not reintroduce
   that phrasing.

5. **WhatsApp, not a signup form.**
   Lower barrier for Butwal, no email verification, no forgotten passwords, and
   we get to talk to the person before granting access. Pre-fill the message:
   `https://wa.me/977XXXXXXXXX?text=Hi%2C%20I%20want%20a%20KothaKhoj%20account`

6. **Copy rules.** Sentence case. Say "your college", never "my college" — the
   site speaks to the user. Keep phrasing simple enough to translate into
   Nepali cleanly.

### Optional — the student shortcut

`Rooms near your college`, as a quiet text link under the primary button.
`rupandehi_colleges.csv` in the repo root already has 92 colleges with lat/lng,
and the directions code already does shortest-path.

Students do not think "show me rooms in Golpark", they think "show me rooms I can
walk to from my campus". This is the feature worth having, and it needs no
account — which is exactly why students should not get logins.

### Rejected — do not propose these again

- A student account. Students only read data; read access needs no login.
- A gate in front of the map. The map is the product.
- Two equal side-by-side option cards.
- A lock icon or "Owners" badge on the login.

### Prompt

```
Read CLAUDE_BRIEF.md and ACCOUNTS_PLAN.md section 8.

TASK: Rebuild src/sa_login/templates/sa_login.html to match the layout and
design rules in section 8.

CONSTRAINTS:
- Map app only. Do not touch the API, the database, or any config file.
- Do not deploy. Show me the diff and stop.
- Mobile first — most users are on phones on slow connections.
- Keep the existing form field names and POST behaviour in
  src/sa_login/views.py working. This is a visual change, not a logic change.
- Section 8's rejected list is final. Do not reintroduce those.

DONE WHEN: the page shows exactly the three blocks in section 8, works on a
375px-wide screen, and logging in still succeeds.

Then tell me:
- what you would improve that I did not ask for, ranked by value per effort
- anything in section 8 you think is wrong for this audience, and why
- what a first-time student visitor would find confusing
```

---

## 9. Room availability dates

### The concept

KothaKhoj is not only landlords listing empty rooms. **A student living in a room
posts it with the date they are leaving**, so the next student knows when it opens
up. Rooms are handed over, not just advertised.

This is why students need to be able to add places, and it is the feature that
makes the map worth checking again next week.

### The field

When adding a room, ask one question:

> **How long will you stay here?**
> Years [ 0 ] Months [ 6 ]
> → Free from 15 Kartik 2083

- Two dropdowns, years and months. Any combination — one day, 6 months,
  4 years 10 months.
- **Required.** The pin is not placed until it is set.
- The app computes a single stored `available_from` date from today + duration.
  Store the date, not the duration — durations go stale the moment they are saved.
- Show the computed date back to the person before they submit, so a mistake is
  visible immediately.

Asking for a duration rather than a date is the right call: a student knows "about
six more months" and does not know "15 Kartik". Let the app do the arithmetic.

### The two states

Derived from `available_from` versus today. Never stored — always computed, so it
can never go stale.

| When | Label | Marker |
|---|---|---|
| Before the date | `Free from 15 Kartik` | muted / neutral pin |
| On or after | `Available now` | success colour pin |

Both states show on the main map, not only in the detail panel. A student should
be able to see what is free without tapping anything.

### Wording — say what they gain, not what they cannot have

"Packed" tells a student they cannot have the room. `Free from 15 Kartik` tells
them **when they can**, which is the thing they actually need in order to plan.
Same fact, useful instead of discouraging, and it matches the rule in section 8:
name what a person gets, never what they are shut out of.

Use:
- `Free from 15 Kartik` — with a quiet "98 days to go" beneath if useful
- `Available now` — with "Free since 2 Ashoj" beneath

Avoid: "Packed", "Occupied", "Not available", "Taken". All of them close a door
that `Free from` leaves open.

### Open questions — decide before building

1. **Bikram Sambat or Gregorian?** Students in Butwal think in BS. This is the
   field that matters most, so a Gregorian-only date is real friction. BS
   conversion needs a library and is not trivial — decide early, it shapes the
   whole feature.
2. **What happens well after the date passes?** A room free since eight months ago
   is probably gone. Options: sort stale listings to the bottom, fade them, or ask
   the poster to confirm. A map full of dead listings is worse than a small one.
3. **Can the poster extend?** A student who stays longer than planned needs to
   push the date back, or their room shows as available when it is not.

### Prompt

```
Read CLAUDE_BRIEF.md and ACCOUNTS_PLAN.md section 9.

TASK: Add the room availability date.

1. Add a required "How long will you stay here?" field to the add-a-room form
   in src/flavors/satish/config.yml — years and months, computed into a stored
   available_from date.
2. Show the computed date back before submit.
3. Show "Free from <date>" or "Available now" on the place detail and on the
   map marker, computed from available_from versus today.

CONSTRAINTS:
- Map app only. Do not touch the API, the database, or any config file.
  Place data is free-form JSON, so no API migration is needed — confirm this
  before starting.
- Do not deploy. Show me the diff and stop.
- Store the date, never the duration.
- Compute the state on read, never store "available" as a value.
- Use the exact wording in section 9. Do not use "Packed" or "Occupied".
- Existing places have no date. They must not break or vanish — decide how
  they display and tell me what you chose.

DONE WHEN: adding a room requires the duration, the detail panel shows the
right label for both a future and a past date, and old dateless places still
render.

Then tell me:
- what you would improve that I did not ask for, ranked by value per effort
- how you handled Bikram Sambat, or why you did not
- what breaks when a date passes and nobody updates it
```

---

## 10. QR login

> **This is the only section that changes the API and the database.** Every other
> section is map-side only. Treat it accordingly — see CLAUDE_BRIEF.md.

### What it does

A poster scans their QR, a link opens, and they are logged in. Nothing typed. They
land where they would after a normal login, able to add a room.

The QR is issued by us along with the account, over WhatsApp.

### Decision already taken

A QR is a bearer credential — anyone who photographs or forwards the image gets the
same access. **This risk has been raised and accepted deliberately.** Do not
re-argue it. Posting access is paid, so the mitigation is detection, not
prevention: record the IP and time of every token use, and revoke a token that
turns up from many different networks.

Revoking a token must not change the person's password. They are separate
credentials for the same account.

### Why the map app cannot do this alone

The map has no database (`settings.py:19`), so it cannot store tokens.

The only map-only version would put the password inside the QR. Django's
`signing.dumps()` is **signed, not encrypted** — the payload is readable base64,
so anyone with the image could extract the password. Rejected.

`sa_api_v2.apikey.ApiKey` already exists but is **not reusable**: it has a
foreign key to `DataSet`, not to `User`. It answers "may this client read this
data", not "who is this person".

### Design

**API (`~/shareabouts-api`)**

- New `LoginToken` model: `user` FK, random token (reuse the generator style in
  `apikey/models.py`), `revoked` flag, `last_used_ip`, `last_used_at`.
- A migration.
- One endpoint that trades a valid, unrevoked token for a session — the same
  session a password login returns, so nothing downstream changes.
- Rate-limit it. It is a guessable-secret endpoint exposed to the internet.

**Map (`~/shareabouts`)**

- A `/login/qr/<token>` route that calls the endpoint and stores the returned
  session cookie exactly as `sa_login/views.py` does today. Reuse that code path;
  do not write a second one.

**Admin**

- Generate and revoke tokens per user from the Django admin.
- Show `last_used_ip` and `last_used_at` in the list, so sharing is visible.

**The QR image itself**

Out of scope for the code. The URL is pasted into any QR generator. Only add a
view that renders one if asked.

### Open questions — decide before building

1. **Does the token expire?** Never-expiring is simplest and matches how the
   password behaves. A 90-day expiry is safer but means reissuing QRs by hand.
2. **One token per user, or many?** Many would let a landlord have one per device
   and revoke a single lost phone. One is simpler.
3. **What happens on a revoked or unknown token?** It must fail to the normal
   login page with a plain message, never a 500.

### Prompt

```
Read CLAUDE_BRIEF.md and ACCOUNTS_PLAN.md section 10.

TASK: [one of — the API model and migration; the API endpoint; the map route;
the admin controls]

THIS TASK TOUCHES THE API AND DATABASE. That is intended and approved for this
section only.

CONSTRAINTS:
- Do not run the migration. Write it, show it to me, and stop.
- Do not deploy. No rsync, no docker compose. Show me the diff and stop.
- Do not touch .env, compose.yml, or local_settings.py.
- Reuse the existing session flow in src/sa_login/views.py and
  src/sa_util/api.py on the map side. Do not write a second login path.
- Do not reuse sa_api_v2.apikey.ApiKey — it is dataset-scoped, not user-scoped.
- The sharing risk in section 10 is accepted. Do not re-argue it.

DONE WHEN: [the observable result, e.g. "scanning the QR lands the user logged
in and able to add a room; a revoked token lands on the login page with a clear
message"]

Then tell me:
- what you would improve that I did not ask for, ranked by value per effort
- what happens if the token endpoint is hit a thousand times a minute
- anything in section 10 you think is wrong, and why
```
