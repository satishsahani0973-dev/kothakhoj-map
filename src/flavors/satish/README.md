# KothaKhoj — decisions behind this flavor

Why the add-a-room form asks what it asks. Read this before changing a field;
most of these look like small config edits and are not.

## Which fields a poster must fill

| Field | Required? | Notes |
|---|---|---|
| Location (address / map pin) | yes | GPS button first, drag as fallback |
| Room Type | yes | single / double / flat |
| **Owner's Contact Number** | **yes, since 2026-09-18** | see below |
| Location Name | no | |
| Description | no | |
| Image | no | shrunk to 1000px in the browser before upload |

"When will the room be free?" is not in that table because it cannot be blank —
it ships pre-selected as **Not sure yet**, so the form is already correct
before anyone touches it.

## The contact number is compulsory

A room nobody can be reached about is not a listing. The contact block in
`custom.js` says it plainly: *"the number is the product: the student rings
from where he is sitting instead of walking the lanes."*

**Making it required took two changes, and neither works alone.**

`optional: true` was removed — but that key **never enforced anything**. The
only thing it does in this entire app is print a small "(optional)" beside the
label, in `sa_web/jstemplates/form-field-label.html`. Removing it changes the
label and nothing else. Anyone who removes it and stops there has changed the
wording and left the field optional.

`required` was added to the field's `attrs`. `attrs` is the only part of a
field config that reaches the `<input>` as real HTML, so it is the part that
actually stops an empty submit. It works because `place-form-view.js` binds
`'submit form'`, and the browser runs its own validation before that event
fires — so an empty box never reaches our JavaScript at all.

`pattern` was already there and was never enough on its own: a pattern only
checks a value that exists, so an empty box always passed it.

**This is browser-side only.** The API stores this form as free JSON and does
not require the key, so a direct POST can still leave it out. Rooms created
before this change also keep their empty number; nothing was backfilled.

## What that means for privacy

Every new room now publishes a **working Nepali mobile number to anyone with
the link**, with no sign-in. That is the deliberate trade — the number is what
makes the map useful — but it is the sharpest thing this site holds, and it
should be a decision rather than a default.

If it ever needs tightening, the place to do it is `KK.gate` in `custom.js`,
which already gates the first visit. The map and the rooms could stay open to
everyone while the number alone sits behind a sign-in.

Two things already reduce the exposure, and are worth being able to say aloud:

- The **college posts under its own account**, so rooms belong to the college
  that listed them, not to us.
- Every room carries a **"Room already taken, wrong rent, or not real?"** link
  to WhatsApp or email, so a student can object without going via the college.

## Taking rooms off the map

Rooms are never deleted to hide them. `visible` on `SubmittedThing` does it,
the API refuses to serve an invisible place, and nothing is lost — photo,
number, dates and description all survive and come back when it is switched
on again.

To hide every room from one college (tested 2026-09-18, works):

1. `https://api.kothakhoj.com/admin/sa_api_v2/place/`
2. Filter **Submitter** → the college
3. Untick **visible** on their rows — it is editable in the list itself
4. **Save**

This works because rooms carry the account that posted them, and colleges post
under their own logins.

Not yet built, both small: a bulk **Hide selected rooms** action instead of
ticking each box, and a hide button on the room itself so a college can take
its own rooms down without asking us. `onToggleVisibility()` in
`place-detail-view.js` is already written and wired — only a button is
missing.

**Do not auto-unhide on a date.** If rooms were hidden because somebody
complained, they must stay hidden until that person is satisfied, not until a
date they never agreed to. Dates belong to availability (`free_ts`), which is
a different question.
