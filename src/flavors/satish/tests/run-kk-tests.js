// KothaKhoj flavor tests. Run with:  node src/flavors/satish/tests/run-kk-tests.js
//
// Covers the logic added for the two-login system and availability colors:
//   - the first-visit sign-in gate decision
//   - the "When will this room be free?" date math (Now / Month / Year)
//   - the availability badge decision (green vs orange, legacy places)
//   - the real config.yml marker rules, substituted and evaluated exactly
//     the way leaflet.argo.js does in the browser
//
// No dependencies: it stubs the few browser globals custom.js touches.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const FLAVOR = path.join(__dirname, '..');

// ---- minimal browser stubs so custom.js can load ----
const chain = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : chainFn),
  apply: () => chain,
});
function chainFn() { return chain; }
const $ = function (arg) { return chain; };
$.trim = s => String(s == null ? '' : s).trim();
global.window = global;
global.jQuery = $;
global.document = {};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.Handlebars = {
  helpers: {},
  registerHelper(name, fn) { this.helpers[name] = fn; },
  SafeString: function (s) { this.string = s; this.toString = () => s; },
};

eval(fs.readFileSync(path.join(FLAVOR, 'static/js/custom.js'), 'utf8'));
const KK = global.KothaKhoj;
assert(KK && KK.gate && KK.freeDate && KK.availability, 'KothaKhoj namespace loaded');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + ' -> ' + e.message); }
}

// ---- gate ----
console.log('gate.shouldShow');
check('anonymous first visit on map -> gate', () => assert.strictEqual(KK.gate.shouldShow(null, false, '/'), true));
check('map route with coords -> gate', () => assert.strictEqual(KK.gate.shouldShow(undefined, false, '/14/27.61997/83.45000'), true));
check('signed-in user -> no gate', () => assert.strictEqual(KK.gate.shouldShow({ username: 'x' }, false, '/'), false));
check('choice already made -> no gate', () => assert.strictEqual(KK.gate.shouldShow(null, true, '/'), false));
check('shared place link -> no gate', () => assert.strictEqual(KK.gate.shouldShow(null, false, '/place/123'), false));

// ---- Nepali month table ----
console.log('bsMonths');
check('table is sorted and every entry parses', () => {
  let prev = 0;
  KK.bsMonths.forEach(mo => {
    const ts = KK.bsTs(mo.ad);
    assert.ok(!isNaN(ts), mo.ad + ' did not parse');
    assert.ok(ts > prev, 'table out of order at ' + mo.ad);
    prev = ts;
  });
});
check('bsTs is NEPAL midnight, identical on every device', () => {
  // These dates name days on a Nepali calendar and the API stores free_ts as
  // Nepal midnight, so both sides must land on the same instant no matter
  // where the phone is. Using the device clock made a room set to Kartik read
  // as "Ashoj" for every viewer behind +05:45 - the whole of India included.
  // This exact number is also what the API's Python produces for that day.
  assert.strictEqual(KK.bsTs('2026-10-18'), 1792260900000);
});
check('and it does not drift when the device is not in Nepal', () => {
  // Recompute the way the old device-local version did, and prove the two
  // disagree anywhere except Nepal - so a regression is caught, not silent.
  const deviceLocal = new Date(2026, 9, 18, 0, 0, 0, 0).getTime();
  const offset = new Date(2026, 9, 18).getTimezoneOffset();
  if (offset !== -345) {
    assert.notStrictEqual(deviceLocal, KK.bsTs('2026-10-18'),
      'device-local midnight should differ outside Nepal');
  }
  // Whatever the device thinks, the label must still name the right month.
  assert.strictEqual(KK.bsLabel(1792260900000), 'Kartik 2083');
});
check('cross-checked against a published festival date', () => {
  // Ghatasthapana 2083 = Ashoj 25 = Sunday 11 Oct 2026 (published).
  // Ashoj 1 must therefore be 24 days earlier, on 17 Sep 2026.
  const ashoj = KK.bsMonths.find(m => m.m === 'Ashoj' && m.y === 2083);
  assert.strictEqual(ashoj.ad, '2026-09-17');
  // Read the instant back in NEPAL, not on whatever machine runs the tests.
  const day25 = new Date(KK.bsTs(ashoj.ad) + 24 * 86400000 + KK.NPT_OFFSET_MS);
  assert.strictEqual(day25.getUTCDate(), 11);
  assert.strictEqual(day25.getUTCMonth(), 9);
  assert.strictEqual(day25.getUTCDay(), 0); // Sunday
});
check('bsUpcoming returns only months still ahead', () => {
  const from = new Date(2026, 9, 20); // 20 Oct 2026, inside Kartik 2083
  const up = KK.bsUpcoming(4, from);
  assert.strictEqual(up.length, 4);
  assert.strictEqual(up[0].m, 'Mangsir');
  up.forEach(mo => assert.ok(mo.ts > from.getTime()));
});
check('bsLabel names the month a moment falls INSIDE', () => {
  // Mid-Kartik, not its first day - must still read Kartik.
  assert.strictEqual(KK.bsLabel(KK.bsTs('2026-10-18') + 5 * 86400000), 'Kartik 2083');
  assert.strictEqual(KK.bsLabel(KK.bsTs('2026-09-17')), 'Ashoj 2083');
});
check('bsLabel falls back to an English date off the end of the table', () => {
  const far = new Date(2099, 0, 1).getTime();
  const label = KK.bsLabel(far);
  assert.ok(label.includes('2099'), 'expected an English fallback, got ' + label);
});
check('bsLabel never renders blank for junk', () => {
  assert.strictEqual(KK.bsLabel(''), '');
  assert.strictEqual(KK.bsLabel('abc'), '');
});

// ---- freeDate ----
console.log('freeDate');
check('now -> state now, no timestamp', () => {
  const r = KK.freeDate.compute('now');
  assert.strictEqual(r.state, 'now');
  assert.strictEqual(r.freeFrom, ''); assert.strictEqual(r.freeTs, '');
});
check('ask -> state ask, and NO timestamp to flip', () => {
  const r = KK.freeDate.compute('ask');
  assert.strictEqual(r.state, 'ask');
  assert.strictEqual(r.freeFrom, ''); assert.strictEqual(r.freeTs, '');
});
check('a chosen month -> state date, ISO date, matching ts', () => {
  const kartik = KK.bsMonths.find(m => m.m === 'Kartik' && m.y === 2083);
  const r = KK.freeDate.compute(kartik);
  assert.strictEqual(r.state, 'date');
  assert.strictEqual(r.freeFrom, '2026-10-18');
  assert.strictEqual(Number(r.freeTs), 1792260900000); // Nepal midnight, same as the API
  assert.strictEqual(r.label, 'Kartik 2083');
});
check('free_ts is ALWAYS numeric-or-empty, never a sentinel', () => {
  // A string like "unknown" in free_ts would be read by Number() as NaN in
  // one place and slip through a `> Date.now()` test in another. The state
  // lives in its own field precisely so this one never carries a non-number.
  ['now', 'ask'].forEach(c => assert.strictEqual(KK.freeDate.compute(c).freeTs, ''));
  const r = KK.freeDate.compute(KK.bsMonths[1]);
  assert.ok(/^\d+$/.test(r.freeTs), 'freeTs was not a plain number: ' + r.freeTs);
});

// ---- availability ----
console.log('availability');
const now = new Date(2026, 7, 8).getTime();
check('free_state is read BEFORE free_ts', () => {
  // The whole point. Number('') is 0 and 0 <= now, so a free_ts-first
  // implementation reports every "ask" room as available now - the exact
  // wasted 20-minute walk this field exists to prevent.
  assert.strictEqual(KK.availability('', now, 'ask').state, 'ask');
  assert.strictEqual(KK.availability(undefined, now, 'ask').state, 'ask');
  assert.strictEqual(KK.availability('0', now, 'ask').state, 'ask');
});
check('explicit now -> now', () => {
  assert.strictEqual(KK.availability('', now, 'now').state, 'now');
});
check('a future date -> later, labelled with the Nepali month', () => {
  const a = KK.availability(String(KK.bsTs('2026-10-18')), now, 'date');
  assert.strictEqual(a.state, 'later');
  assert.strictEqual(a.label, 'Kartik 2083');
});
check('the date has passed -> now', () => {
  // The month arriving flips the room green by itself. The date was named
  // by the student leaving that room, so it is trusted until it is changed.
  assert.strictEqual(KK.availability(String(now - 1000), now, 'date').state, 'now');
});
check('state date but no timestamp -> ask, never green', () => {
  assert.strictEqual(KK.availability('', now, 'date').state, 'ask');
});
check('legacy row with a usable date is still trusted', () => {
  // No free_state at all: if the poster really did pick a date, keep it.
  assert.strictEqual(KK.availability(String(KK.bsTs('2026-10-18')), now).state, 'later');
  assert.strictEqual(KK.availability(String(now - 1000), now).state, 'now');
});
check('legacy row with nothing at all -> ask, not green', () => {
  // We know nothing about it, so it fails toward "go and ask" rather than
  // toward "walk across town".
  assert.strictEqual(KK.availability(undefined, now).state, 'ask');
  assert.strictEqual(KK.availability('', now).state, 'ask');
  assert.strictEqual(KK.availability('undefined', now).state, 'ask');
});

// ---- badge helper ----
console.log('free_badge helper');
check('explicit now -> green badge', () => {
  const html = String(Handlebars.helpers.free_badge('', 'now'));
  assert.ok(html.includes('free-badge-now') && html.includes('Available now'));
});
check('ask -> blue badge that names the action, not a bare order', () => {
  const html = String(Handlebars.helpers.free_badge('', 'ask'));
  assert.ok(html.includes('free-badge-ask'), html);
  assert.ok(html.includes('Someone lives here now'), html);
  assert.ok(html.includes('call and ask'), html);
});
check('the badge never says a bare "Ask" with no object', () => {
  // "Ask" alone reads as "go and knock" - the twenty-minute walk across
  // town - while a call button sits directly underneath it.
  const html = String(Handlebars.helpers.free_badge('', 'ask'));
  assert.ok(!/>Ask\b/.test(html), html);
});
check('a passed date -> green badge', () => {
  // The helper reads the real clock, so use a month that has genuinely
  // gone by. Bhadra 2083 began 17 Aug 2026.
  const html = String(Handlebars.helpers.free_badge(String(KK.bsTs('2026-08-17')), 'date'));
  assert.ok(html.includes('free-badge-now') && html.includes('Available now'), html);
});
check('future date -> orange badge naming the Nepali month', () => {
  const html = String(Handlebars.helpers.free_badge(String(KK.bsTs('2029-04-14')), 'date'));
  assert.ok(html.includes('free-badge-later'), html);
  assert.ok(html.includes('Baisakh 2086'), html);
});
check('called with one argument, Handlebars options is not read as a state', () => {
  // Handlebars always appends its own options object. A template passing
  // only free_ts must not have that object treated as a free_state.
  const html = String(Handlebars.helpers.free_badge(String(KK.bsTs('2029-04-14')), { hash: {} }));
  assert.ok(html.includes('free-badge-later'), html);
});

// ---- location engine decisions ----
console.log('geo.isFresh / geo.quality');
check('fresh fix within 2 minutes -> reuse', () => {
  const t = 1000000000;
  assert.strictEqual(KK.geo.isFresh({ ts: t - 60 * 1000, lat: 1, lng: 1 }, t), true);
});
check('old or missing fix -> ask GPS again', () => {
  const t = 1000000000;
  assert.strictEqual(KK.geo.isFresh({ ts: t - 3 * 60 * 1000 }, t), false);
  assert.strictEqual(KK.geo.isFresh(null, t), false);
  assert.strictEqual(KK.geo.isFresh({}, t), false);
});
check('accuracy <= 50 m -> good, else weak', () => {
  assert.strictEqual(KK.geo.quality(15), 'good');
  assert.strictEqual(KK.geo.quality(50), 'good');
  assert.strictEqual(KK.geo.quality(80), 'weak');
  assert.strictEqual(KK.geo.quality(undefined), 'weak');
});

// ---- auto-fit cluster ----
console.log('fit.cluster');
check('drops a faraway outlier, keeps the dense cluster', () => {
  const butwal = [[27.62, 83.45], [27.63, 83.46], [27.61, 83.44], [27.64, 83.47]];
  const outlier = [27.42, 83.26]; // ~30 km away
  const kept = KK.fit.cluster(butwal.concat([outlier]));
  assert.strictEqual(kept.length, 4);
  assert.ok(!kept.some(p => p[0] === 27.42));
});
check('fewer than 3 pins -> keep all (no cluster to judge)', () => {
  const two = [[27.62, 83.45], [27.42, 83.26]];
  assert.deepStrictEqual(KK.fit.cluster(two), two);
  assert.deepStrictEqual(KK.fit.cluster([]), []);
});
check('all pins close together -> all kept', () => {
  const pts = [[27.62, 83.45], [27.63, 83.46], [27.61, 83.44]];
  assert.strictEqual(KK.fit.cluster(pts).length, 3);
});

// ---- QR token extraction ----
console.log('qr.extractToken');
check('full card URL -> token', () =>
  assert.strictEqual(KK.qr.extractToken('https://kothakhoj.com/qr/ofe2rL_wSOQI3o42M03eqKhwpcAECtHM'),
    'ofe2rL_wSOQI3o42M03eqKhwpcAECtHM'));
check('local dev URL -> token', () =>
  assert.strictEqual(KK.qr.extractToken('http://127.0.0.1:8080/qr/abcDEF123_-abcDEF123'), 'abcDEF123_-abcDEF123'));
check('bare token -> token', () =>
  assert.strictEqual(KK.qr.extractToken('  abcDEF123_-abcDEF123  '), 'abcDEF123_-abcDEF123'));
check('random QR content -> null (never navigate to strange QRs)', () => {
  assert.strictEqual(KK.qr.extractToken('https://evil.example.com/win-money'), null);
  assert.strictEqual(KK.qr.extractToken('hello world'), null);
  assert.strictEqual(KK.qr.extractToken(''), null);
  assert.strictEqual(KK.qr.extractToken('/qr/short'), null);
});

// ---- colleges CSV parsing ----
console.log('colleges.parseCsv');
check('parses name/lat/lng rows', () => {
  const rows = KK.colleges.parseCsv('name,lat,lng,aliases\nButwal Multiple Campus,27.694,83.464,BMC\nKalika Campus,27.686,83.465,');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Butwal Multiple Campus');
  assert.strictEqual(rows[1].lat, 27.686);
});
check('drops rows with bad or missing coordinates', () => {
  const rows = KK.colleges.parseCsv('name,lat,lng\nGood,27.6,83.4\nNoCoords,,\nBadCoords,abc,def\n,27.7,83.5');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Good');
});
check('empty or header-only text -> no colleges', () => {
  assert.deepStrictEqual(KK.colleges.parseCsv(''), []);
  assert.deepStrictEqual(KK.colleges.parseCsv('name,lat,lng'), []);
});

// ---- real config.yml marker rules ----
console.log('config.yml marker conditions (argo substitution + eval)');
const configText = fs.readFileSync(path.join(FLAVOR, 'config.yml'), 'utf8');

// The three room types must share the single anchored rule list.
check('double_room and flat alias the anchored rules', () => {
  assert.ok(configText.includes('rules: &availability-rules'), 'anchor exists');
  assert.strictEqual(configText.split('rules: *availability-rules').length - 1, 2, 'two aliases');
});

// Extract the anchored rules (condition + iconUrl, in order) from the yaml text.
const anchorBlock = configText.split('rules: &availability-rules')[1].split('double_room:')[0];
const rules = [];
for (const m of anchorBlock.matchAll(/- condition: '([^']+)'[\s\S]*?iconUrl: (\S+)/g)) {
  rules.push({ condition: m[1], icon: m[2] });
}
check('six rules extracted from config', () => assert.strictEqual(rules.length, 6));

// Reimplementation of L.Argo.t: replace {{ token }} with the property value;
// a missing property substitutes the string "undefined".
function argoT(str, obj) {
  return str.replace(/\{\{ *([\w\.-]+) *\}\}/g, (m, key) => {
    let val = obj;
    for (const p of key.split('.')) { val = val == null ? val : val[p]; }
    return String(val);
  });
}
function firstIcon(props) {
  for (const rule of rules) {
    if (eval(argoT(rule.condition, props))) { return rule.icon; }
  }
  return '';
}
const FUTURE = String(Date.now() + 1000000);
const PAST = String(Date.now() - 1000000);

// The regression this whole feature turns on.
check('ask + empty free_ts -> BLUE dot, never green', () =>
  assert.ok(firstIcon({ free_state: 'ask', free_ts: '', layer: { focused: false } }).includes('dot-0d85e9'),
    'Number("") is 0 and 0 <= now, so an unguarded rule paints every ask pin green'));
check('ask ignores a stray timestamp too', () =>
  assert.ok(firstIcon({ free_state: 'ask', free_ts: FUTURE, layer: { focused: false } }).includes('dot-0d85e9')));

check('now -> green dot', () =>
  assert.ok(firstIcon({ free_state: 'now', free_ts: '', layer: { focused: false } }).includes('dot-4bbd45')));
check('date + future -> orange dot', () =>
  assert.ok(firstIcon({ free_state: 'date', free_ts: FUTURE, layer: { focused: false } }).includes('dot-f95016')));
check('date + past -> green dot (auto flip)', () =>
  assert.ok(firstIcon({ free_state: 'date', free_ts: PAST, layer: { focused: false } }).includes('dot-4bbd45')));
check('date but no timestamp -> blue, never green', () =>
  assert.ok(firstIcon({ free_state: 'date', free_ts: '', layer: { focused: false } }).includes('dot-0d85e9')));

// Places saved before this feature carry no free_state at all.
check('legacy with nothing -> blue dot (catch-all fails safe)', () =>
  assert.ok(firstIcon({ layer: { focused: false } }).includes('dot-0d85e9')));
check('legacy with a real future date is still trusted -> orange', () =>
  assert.ok(firstIcon({ free_ts: FUTURE, layer: { focused: false } }).includes('dot-f95016')));
check('legacy with a passed date -> green', () =>
  assert.ok(firstIcon({ free_ts: PAST, layer: { focused: false } }).includes('dot-4bbd45')));
check('the badge and the pin agree about an expired date', () => {
  // Two separate implementations decide this - KK.availability for the
  // badge, the config rules for the pin colour. They drifted apart once
  // before; if one is changed the other must move with it.
  const jsState = KK.availability(PAST, Date.now(), 'date').state;
  const pinIsGreen = firstIcon({ free_state: 'date', free_ts: PAST, layer: { focused: false } })
    .includes('dot-4bbd45');
  assert.strictEqual(jsState === 'now', pinIsGreen,
    'badge says ' + jsState + ' but the pin green-ness is ' + pinIsGreen);
});

check('focused + date + future -> big orange marker', () =>
  assert.ok(firstIcon({ free_state: 'date', free_ts: FUTURE, layer: { focused: true } }).includes('marker-f95016')));
check('focused + now -> big green marker', () =>
  assert.ok(firstIcon({ free_state: 'now', free_ts: '', layer: { focused: true } }).includes('marker-4bbd45')));
check('focused + ask -> big blue marker', () =>
  assert.ok(firstIcon({ free_state: 'ask', free_ts: '', layer: { focused: true } }).includes('marker-0d85e9')));
check('focused rules come before the unfocused ones', () => {
  // A bare '{{layer.focused}} === true' placed too early would swallow
  // every focused pin and paint it blue.
  const icon = firstIcon({ free_state: 'now', free_ts: '', layer: { focused: true } });
  assert.ok(!icon.includes('0d85e9'), 'focused green pin was swallowed by the blue focused rule');
});

check('every free_state comparison in config is QUOTED', () => {
  // L.Argo.t splices the raw value in and the result is eval'd with no
  // try/catch, so a bare {{free_state}} becomes an identifier and throws
  // out of initLayer - the pin then never renders at all.
  rules.forEach(r => {
    assert.ok(!/[^"]\{\{free_state\}\}/.test(r.condition),
      'unquoted free_state in: ' + r.condition);
  });
});
check('config conditions never throw on a place with no data at all', () => {
  assert.doesNotThrow(() => firstIcon({ layer: { focused: false } }));
  assert.doesNotThrow(() => firstIcon({ layer: { focused: true } }));
});

// ---- directions logic ----
console.log('route (directions logic)');
check('short trip -> walking', () =>
  assert.strictEqual(KK.route.pickProfile(1200, null), 'walking'));
check('long trip -> driving', () =>
  assert.strictEqual(KK.route.pickProfile(9000, null), 'driving'));
check('remembered cycling wins', () =>
  assert.strictEqual(KK.route.pickProfile(400, 'cycling'), 'cycling'));
check('remembered walking ignored when unwalkable', () =>
  assert.strictEqual(KK.route.pickProfile(12000, 'walking'), 'driving'));
check('junk preference ignored', () =>
  assert.strictEqual(KK.route.pickProfile(500, 'rocket'), 'walking'));
check('summary under a km rounds to 10 m', () =>
  assert.strictEqual(KK.route.fmtSummary(846, 700), '850 m · 12 min'));
check('summary km with hour formatting', () =>
  assert.strictEqual(KK.route.fmtSummary(2400, 3900), '2.4 km · 1h 05min'));
check('summary never shows 0 min', () =>
  assert.strictEqual(KK.route.fmtSummary(40, 20), '40 m · 1 min'));
check('arrived inside 30 m', () =>
  assert.strictEqual(KK.route.isArrived(29), true));
check('not arrived at 31 m', () =>
  assert.strictEqual(KK.route.isArrived(31), false));
check('waLink plain mobile', () =>
  assert.strictEqual(KK.route.waLink('9812345678'), 'https://wa.me/9779812345678'));
check('waLink strips leading zero', () =>
  assert.strictEqual(KK.route.waLink('09812345678'), 'https://wa.me/9779812345678'));
check('waLink strips country code and separators', () =>
  assert.strictEqual(KK.route.waLink('+977 981-2345678'), 'https://wa.me/9779812345678'));
check('waLink rejects short numbers', () =>
  assert.strictEqual(KK.route.waLink('071-591'), null));
check('waLink rejects empty', () =>
  assert.strictEqual(KK.route.waLink(''), null));

// ---- Device-bound ownership rules (shared accounts) ----
check('device rules: bound place, other device -> no delete', () =>
  assert.strictEqual(KK.deviceRules.canDelete(true, true, false, true), false));
check('device rules: bound place, my device -> delete', () =>
  assert.strictEqual(KK.deviceRules.canDelete(true, true, true, false), true));
check('device rules: bound place, wrong account -> never', () =>
  assert.strictEqual(KK.deviceRules.canDelete(true, false, true, false), false));
check('device rules: unbound place keeps account rule', () =>
  assert.strictEqual(KK.deviceRules.canDelete(false, true, false, false), true));
check('device rules: unbound anonymous legacy token rule', () =>
  assert.strictEqual(KK.deviceRules.canDelete(false, false, false, true), true));
check('yours rules: bound place, other device -> not mine', () =>
  assert.strictEqual(KK.deviceRules.isMine(true, false, true), false));
check('yours rules: bound place, my device -> mine', () =>
  assert.strictEqual(KK.deviceRules.isMine(true, true, false), true));
check('yours rules: unbound keeps legacy token match', () =>
  assert.strictEqual(KK.deviceRules.isMine(false, false, true), true));
check('yours rules: unbound with my-list match', () =>
  assert.strictEqual(KK.deviceRules.isMine(false, true, false), true));

// ---- add-place form: GPS first, room type chips ----
console.log('add-place form');
const formTpl = fs.readFileSync(path.join(FLAVOR, 'jstemplates/place-form.html'), 'utf8');
check('GPS is the primary button, dragging is the fallback line', () => {
  assert.ok(/use-location-primary/.test(formTpl), 'primary button present');
  assert.ok(/Use my current location/.test(formTpl), 'says what it does');
  assert.ok(!/use-location-chip/.test(formTpl), 'the old small chip is gone');
  assert.ok(/or drag the map to the room/.test(formTpl), 'dragging demoted to a hint');
});
check('GPS button wording matches in every state', () => {
  const js = fs.readFileSync(path.join(FLAVOR, 'static/js/custom.js'), 'utf8');
  assert.ok(/text\('Finding you…'\)/.test(js), 'while locating');
  assert.ok(/text\('Find me again'\)/.test(js), 'after success');
  assert.ok(/text\('Use my current location'\)/.test(js), 'after refusal');
});
check('room type is a one-tap radio group, not a dropdown', () => {
  assert.ok(/_\(Room Type\)/.test(configText), 'renamed from Location Type');
  assert.ok(!/_\(Location Type\)/.test(configText), 'old label gone');
  // "_(Room Type)" appears twice (prompt and label) — take the text after
  // the LAST one, or the slice is just the gap between them.
  const block = configText.split('_(Room Type)').pop().split('name: location_type')[0];
  assert.ok(/type: radiogroup/.test(block), 'radiogroup, not select');
  assert.ok(!/Choose One/.test(block), 'no empty placeholder option');
  assert.ok(/single_room/.test(block) && /double_room/.test(block) && /flat/.test(block));
});
check('room type keeps its old field name so existing rooms still work', () =>
  assert.ok(/name: location_type/.test(configText)));
check('chip styling targets the markup the template actually renders', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  // The radio sits INSIDE the label, followed by span.radio-label-text.
  assert.ok(/input\[type="radio"\]:checked \+ \.radio-label-text/.test(css));
  assert.ok(/input\[type="radio"\]:focus \+ \.radio-label-text/.test(css),
    'focus stays visible for keyboard users');
});
check('comment box is shortened but keeps the name field', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  assert.ok(/#new_response textarea[\s\S]{0,120}?height: 3\.4em/.test(css), 'two rows');
  const survey = configText.split('survey:')[1] || '';
  assert.ok(/name: submitter_name/.test(survey), 'Your Name kept, as Satish asked');
});

// ---- college search aliases (bug: split on "," but the sheet uses "/") ----
console.log('college search alias splitting');
check('map-view splits aliases on the slash the sheet actually uses', () => {
  const mv = fs.readFileSync(
    path.join(FLAVOR, '../../sa_web/static/js/views/map-view.js'), 'utf8');
  assert.ok(/aliases\.split\(\/\[\\\/,\]\/\)/.test(mv),
    'splits on / as well as ,');
  assert.ok(!/aliases\.split\(','\)/.test(mv),
    'the comma-only split is gone');
});
check('a slash-separated alias list becomes separate search terms', () => {
  // Mirrors what loadFuse builds, so the two Kalika sectors stay distinct.
  const aliases = 'kalika mano vigyan/kalika sector 1/kalika science';
  const terms = aliases.split(/[\/,]/).map(s => s.trim()).filter(Boolean);
  assert.deepStrictEqual(terms,
    ['kalika mano vigyan', 'kalika sector 1', 'kalika science']);
});
check('search result shows which alias matched, so sectors are tellable apart', () => {
  const mv = fs.readFileSync(
    path.join(FLAVOR, '../../sa_web/static/js/views/map-view.js'), 'utf8');
  assert.ok(/place\.displayName && place\.name !== place\.displayName/.test(mv),
    'only shows the alias when it differs from the official name');
  assert.ok(/\.text\([^)]*\(matched \|\| label\)\)/.test(mv),
    'leads with the alias the student typed');
  assert.ok(/\$item\.append\([\s\S]{0,120}?\.text\(/.test(mv),
    'the place name is appended as escaped text, not raw html');
  assert.ok(/\$input\.val\(label\)/.test(mv),
    'clicking still puts the clean official name in the box');
});
check('search tolerates how students really type (no spaces, typos)', () => {
  const mv = fs.readFileSync(
    path.join(FLAVOR, '../../sa_web/static/js/views/map-view.js'), 'utf8');
  assert.ok(/normalizeSearch/.test(mv), 'has a normaliser');
  assert.ok(/replace\(\/\[\^a-z0-9ऀ-ॿ\]\/g, ''\)/.test(mv),
    'strips spaces and punctuation but keeps Devanagari');
  assert.ok(/self\.localSearch\s*=/.test(mv), 'exact/prefix pass exists');
  assert.ok(/self\.localSearch \? self\.localSearch\(query\)/.test(mv),
    'the search box actually uses it');
});
check('normalising squashes the ways one name gets typed', () => {
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, '');
  assert.strictEqual(norm('AMDA College'), 'amdacollege');
  assert.strictEqual(norm('amdacollege'), 'amdacollege');
  assert.strictEqual(norm('kalika sector 1'), 'kalikasector1');
  assert.strictEqual(norm('KalikaSector1'), 'kalikasector1');
  assert.strictEqual(norm('कालिका मानवज्ञान'), 'कालिकामानवज्ञान');
});
check('a query longer than the alias still matches by prefix', () => {
  // "amdacollege" starts with the alias "amda" -> rank 2, beating fuzzy noise
  const norm = s => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, '');
  const q = norm('amda college'), alias = norm('amda');
  assert.ok(q.indexOf(alias) === 0 && alias.length >= 3);
});
check('empty alias fragments are dropped, not searched', () => {
  const terms = 'kalika/kalika college//'.split(/[\/,]/).map(s => s.trim()).filter(Boolean);
  assert.deepStrictEqual(terms, ['kalika', 'kalika college']);
});

// ---- month-end dates ----
// The old picker did calendar arithmetic (today + N months) and 31 Jan + 1
// month landed on 3 March, skipping February. That whole class of bug is
// now impossible: a room is always free from the FIRST day of a chosen
// Nepali month, read from a table, so nothing is ever added to a date.
console.log('freeDate month starts');
check('every table entry is the 1st of its Nepali month, at NEPAL midnight', () => {
  KK.bsMonths.slice(0, 12).forEach(mo => {
    // Shift into Nepal before reading the clock fields, so this holds on a
    // laptop in any timezone as well as on a phone in Butwal.
    const d = new Date(Number(KK.freeDate.compute(mo).freeTs) + KK.NPT_OFFSET_MS);
    assert.strictEqual(d.getUTCHours(), 0, mo.ad + ' is not at Nepal midnight');
    assert.strictEqual(d.getUTCMinutes(), 0);
    assert.strictEqual(d.getUTCSeconds(), 0);
  });
});
check('no month arithmetic survives - compute takes a table entry, not a count', () => {
  // Guards against someone reintroducing compute('month', n).
  const r = KK.freeDate.compute('month', 1, new Date(2026, 0, 31));
  assert.strictEqual(r.state, 'date',
    'compute should treat a stray string as an object-less choice, not do arithmetic');
});
check('a room is green from the first NEPAL morning of its month', () => {
  // The pin must flip at the start of the day in Nepal, not at whatever
  // hour the viewer's device thinks the day starts - that bug once showed
  // a Kartik room as Ashoj to everyone behind +05:45.
  const kartik = KK.bsMonths.find(m => m.m === 'Kartik' && m.y === 2083);
  const r = KK.freeDate.compute(kartik);
  const morning = KK.bsTs('2026-10-18') + 8 * 60 * 60 * 1000; // 08:00 in Nepal
  assert.strictEqual(KK.availability(r.freeTs, morning, 'date').state, 'now');
});
check('and still orange the evening before', () => {
  const kartik = KK.bsMonths.find(m => m.m === 'Kartik' && m.y === 2083);
  const r = KK.freeDate.compute(kartik);
  const nightBefore = KK.bsTs('2026-10-18') - 30 * 60 * 1000; // 23:30 in Nepal
  assert.strictEqual(KK.availability(r.freeTs, nightBefore, 'date').state, 'later');
});
check('an "ask" room NEVER flips on its own', () => {
  // There is no timestamp, so there is nothing to expire. A month nobody
  // chose must not turn a pin green years later.
  const r = KK.freeDate.compute('ask');
  const farFuture = new Date(2099, 0, 1).getTime();
  assert.strictEqual(KK.availability(r.freeTs, farFuture, r.state).state, 'ask');
});

// ---- sign-in gate release (bug: Back button left the map blurred) ----
console.log('gate.shouldRelease');
check('panel shown then gone -> lift the blur', () =>
  assert.strictEqual(KK.gate.shouldRelease(true, false, true), true));
check('panel still open -> keep the blur', () =>
  assert.strictEqual(KK.gate.shouldRelease(true, true, true), false));
check('gate raised but panel not rendered yet -> do NOT lift early', () =>
  assert.strictEqual(KK.gate.shouldRelease(true, false, false), false));
check('no gate -> nothing to do', () =>
  assert.strictEqual(KK.gate.shouldRelease(false, false, true), false));

// ---- turn-by-turn instructions ----
console.log('route.nextInstruction / fmtStepDistance');
const STEPS = [
  { text: 'Walk east on Buddha Path', index: 0 },
  { text: 'Turn left onto Purano Sadak', index: 4 },
  { text: 'Turn right onto Devdaha Marg', index: 9 },
  { text: 'You have arrived', index: 14 },
];
check('at the start -> the first turn', () =>
  assert.strictEqual(KK.route.nextInstruction(STEPS, 0).text, 'Walk east on Buddha Path'));
check('mid-route -> the turn still ahead, not the one passed', () =>
  assert.strictEqual(KK.route.nextInstruction(STEPS, 5).text, 'Turn right onto Devdaha Marg'));
check('exactly on a maneuver -> that maneuver', () =>
  assert.strictEqual(KK.route.nextInstruction(STEPS, 4).text, 'Turn left onto Purano Sadak'));
check('past the last maneuver -> keeps the arrival step', () =>
  assert.strictEqual(KK.route.nextInstruction(STEPS, 99).text, 'You have arrived'));
check('no instructions -> null (card falls back to the old wording)', () => {
  assert.strictEqual(KK.route.nextInstruction([], 0), null);
  assert.strictEqual(KK.route.nextInstruction(null, 0), null);
});
check('step distance: on top of the turn reads "now"', () =>
  assert.strictEqual(KK.route.fmtStepDistance(12), 'now'));
check('step distance: metres are rounded to a judgeable 10', () =>
  assert.strictEqual(KK.route.fmtStepDistance(147), 'in 150 m'));
check('step distance: long legs switch to km', () =>
  assert.strictEqual(KK.route.fmtStepDistance(2400), 'in 2.4 km'));
check('step distance: rubbish input does not print NaN', () =>
  assert.strictEqual(KK.route.fmtStepDistance(NaN), 'now'));

// ---- availability legend ----
console.log('legend');
check('legend has all three stacked rows with matching dots', () => {
  const html = KK.legend.html();
  assert.ok(html.includes('Available now'), 'green label');
  assert.ok(html.includes('Free later'), 'orange label');
  assert.ok(html.includes('call and ask'), 'blue label names the action');
  assert.ok(html.includes('kk-legend-dot-free'), 'green dot class');
  assert.ok(html.includes('kk-legend-dot-taken'), 'orange dot class');
  assert.ok(html.includes('kk-legend-dot-ask'), 'blue dot class');
});
check('legend does not say "Not available" - a parent reads that as gone', () =>
  assert.ok(KK.legend.html().indexOf('Not available') === -1));
check('every legend dot class is actually styled', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  ['kk-legend-dot-free', 'kk-legend-dot-taken', 'kk-legend-dot-ask'].forEach(cls => {
    assert.ok(new RegExp('\\.' + cls + '\\s*\\{[^}]*background').test(css), cls + ' has no colour');
  });
});
check('legend never uses the rejected word Occupied', () =>
  assert.ok(KK.legend.html().indexOf('Occupied') === -1));
check('legend hides for the WHOLE directions flow, not just while walking', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  // kk-directions is set the moment Directions is tapped; kk-routing only
  // once Start is pressed — which left the preview card covered on phones.
  assert.ok(/body\.kk-directions\s+\.kk-legend\s*\{[^}]*display:\s*none/.test(css),
    'legend keyed off kk-directions');
  assert.ok(!/body\.kk-routing\s+\.kk-legend\s*\{/.test(css),
    'the old walking-only rule is gone');
});
check('welcome line / Add-a-place pill clear the route card too', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  assert.ok(/body\.kk-directions\s+#add-place-btn-container\s*\{[^}]*display:\s*none/.test(css));
});
check('activity strip stays white with readable dark text', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  assert.ok(/#ticker\s*\{[\s\S]{0,200}?background:\s*rgba\(255, 255, 255/.test(css),
    'white strip kept');
  assert.ok(/#ticker \.recent-points li[\s\S]{0,260}?color:\s*#333/.test(css),
    'sentence is dark');
  assert.ok(/#ticker \.recent-points li strong[\s\S]{0,120}?color:\s*#007fbf/.test(css),
    'poster name in KothaKhoj blue');
});
check('directions class is added on start and cleared on stop', () => {
  const mv = fs.readFileSync(
    path.join(FLAVOR, '../../sa_web/static/js/views/map-view.js'), 'utf8');
  assert.ok(/addClass\('kk-directions'\)/.test(mv), 'added');
  assert.ok(/removeClass\('kk-directions'\)/.test(mv), 'cleared');
});
check('legend wording matches the detail badge family', () => {
  // Each legend row must describe the same thing its badge does, or the
  // colour key teaches the reader the wrong vocabulary.
  const legend = KK.legend.html();
  assert.ok(String(Handlebars.helpers.free_badge('', 'now')).includes('Available now') &&
    legend.includes('Available now'), 'green wording');
  const askBadge = String(Handlebars.helpers.free_badge('', 'ask'));
  assert.ok(askBadge.includes('Someone lives here') && legend.includes('Someone lives here'),
    'blue wording: both must state the fact');
  assert.ok(askBadge.includes('call and ask') && legend.includes('call and ask'),
    'blue wording: both must name the same action');
  assert.ok(String(Handlebars.helpers.free_badge(String(KK.bsTs('2029-04-14')), 'date')).includes('Free from') &&
    legend.includes('Free later'), 'orange wording');
});

// ---- owner contact ----
console.log('contact');
check('role labels: owner / other / legacy', () => {
  assert.strictEqual(KK.contact.roleLabel('owner'), 'Owner');
  assert.strictEqual(KK.contact.roleLabel('other'), 'Contact person');
  assert.strictEqual(KK.contact.roleLabel(undefined), 'Contact');
  assert.strictEqual(KK.contact.roleLabel(''), 'Contact');
});
check('block: owner number -> label, number, wa link, button text', () => {
  const html = KK.contact.blockHtml('9812345678', 'owner');
  assert.ok(html.includes('>Owner<'), 'label');
  assert.ok(html.includes('9812345678'), 'number shown');
  assert.ok(html.includes('https://wa.me/9779812345678'), 'wa link');
  assert.ok(html.includes('WhatsApp the owner'), 'button text');
});
check('block: other person -> Contact person wording', () => {
  const html = KK.contact.blockHtml('9812345678', 'other');
  assert.ok(html.includes('Contact person'));
  assert.ok(html.includes('WhatsApp the contact person'));
});
check('block: legacy place without role -> neutral Contact', () => {
  const html = KK.contact.blockHtml('9812345678', undefined);
  assert.ok(html.includes('>Contact<'));
});
check('block: no number -> renders nothing', () => {
  assert.strictEqual(KK.contact.blockHtml('', 'owner'), '');
  assert.strictEqual(KK.contact.blockHtml(null, 'owner'), '');
  assert.strictEqual(KK.contact.blockHtml('   ', 'owner'), '');
});
check('block: too-short number -> shown but no wa button', () => {
  const html = KK.contact.blockHtml('12345', 'owner');
  assert.ok(html.includes('12345'));
  assert.ok(!html.includes('wa.me'));
});
check('block: Call comes BEFORE WhatsApp', () => {
  // Most rooms on this map are occupied, so the number is the product -
  // the student rings from where he is sitting instead of walking the
  // lanes. Plenty of Butwal landlords have no WhatsApp at all.
  const html = KK.contact.blockHtml('9812345678', 'owner');
  assert.ok(html.includes('tel:+9779812345678'), 'dialable link: ' + html);
  assert.ok(html.includes('Call the owner'), 'call button text');
  assert.ok(html.indexOf('kk-call-btn') < html.indexOf('kk-wa-btn'),
    'WhatsApp was rendered before Call');
});
check('block: too-short number -> no call button either', () => {
  const html = KK.contact.blockHtml('12345', 'owner');
  assert.ok(!html.includes('tel:'), 'a half-typed number must not render a dead button');
});
check('telHref and waLink always agree about the number they reach', () => {
  ['9812345678', '098-1234-5678', '977 9812345678', '+9779812345678'].forEach(n => {
    const tel = KK.contact.telHref(n);
    const wa = KK.route.waLink(n);
    assert.strictEqual(tel, 'tel:+9779812345678', n);
    assert.strictEqual(wa, 'https://wa.me/9779812345678', n);
  });
  assert.strictEqual(KK.contact.telHref(''), null);
  assert.strictEqual(KK.contact.telHref(null), null);
});
check('the call button is actually styled', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  assert.ok(/\.kk-call-btn[^{]*\{[^}]*background/.test(css), 'kk-call-btn has no colour');
});
check('block escapes html in the stored number', () => {
  const html = KK.contact.blockHtml('<img src=x>', 'owner');
  assert.ok(!html.includes('<img'), 'markup neutralized');
});
check('contact_block helper wraps blockHtml as SafeString', () => {
  const out = Handlebars.helpers.contact_block('9812345678', 'owner');
  assert.ok(String(out).includes('kk-contact'));
});

// ---- config + template wiring ----
console.log('config/template wiring');

// ---- the free picker's safe default ----
// This is the property the whole design rests on: a poster who scrolls
// straight past must still produce an honest answer, with no JavaScript
// having run. So the markup default and the hidden input must agree on
// their own, without any render hook.
const formHtml = fs.readFileSync(path.join(FLAVOR, 'jstemplates/place-form.html'), 'utf8');
check('the hidden free_state ships as "ask"', () =>
  assert.ok(/name="free_state"\s+value="ask"/.test(formHtml), 'default is not ask'));
check('and the "Not sure yet" button ships pre-selected to match it', () => {
  const askBtn = formHtml.match(/<button[^>]*data-kind="ask"[^>]*>/);
  assert.ok(askBtn, 'no ask button');
  assert.ok(askBtn[0].includes('is-active'), 'ask button is not the active one');
});
check('no OTHER kind button is also marked active', () => {
  const actives = (formHtml.match(/<button[^>]*free-kind[^>]*is-active/g) || []);
  assert.strictEqual(actives.length, 1, 'exactly one kind may be pre-selected');
});
check('the baked-in preview shows the ask badge, matching the default', () =>
  assert.ok(/free-badge-ask/.test(formHtml), 'preview contradicts the stored default'));
check('the question sits ABOVE the field set, not below the photo upload', () => {
  const picker = formHtml.indexOf('class="free-picker"');
  const fieldSet = formHtml.indexOf('form-field-set');
  assert.ok(picker !== -1 && fieldSet !== -1);
  assert.ok(picker < fieldSet, 'the picker is still buried below the other fields');
});
check('the old month-counter control is gone', () => {
  ['data-kind="year"', 'free-count-custom', 'or type'].forEach(dead =>
    assert.ok(!formHtml.includes(dead), 'leftover from the old picker: ' + dead));
});
const detailForPicker = fs.readFileSync(path.join(FLAVOR, 'jstemplates/place-detail.html'), 'utf8');
check('detail template passes free_state to the badge', () => {
  assert.ok(/free_badge\s+free_ts\s+free_state/.test(detailForPicker),
    'badge called without the state - every ask room would render green');
});
check('the posted-on stamp appears exactly once on the detail page', () => {
  const stamps = (detailForPicker.match(/fromnow created_datetime/g) || []);
  assert.strictEqual(stamps.length, 1, 'the timestamp is printed twice');
});

check("config: contact field relabeled to Owner's Contact Number", () =>
  assert.ok(configText.includes("_(Owner's Contact Number)")));
check('the "Whose number is this?" question is gone from the form', () => {
  // Satish removed it 2026-08-25 — one less thing to answer per room. The
  // KK.contact helpers stay: older places still carry a role, and they must
  // keep rendering correctly.
  assert.ok(!configText.includes('name: contact_role'), 'field removed');
  assert.ok(!configText.includes('Whose number is this?'), 'label removed');
});
const detailTpl = fs.readFileSync(path.join(FLAVOR, 'jstemplates/place-detail.html'), 'utf8');
check('detail template: generic loop excludes both contact fields', () =>
  assert.ok(detailTpl.includes('"contact_number" "contact_role"')));
check('detail template: renders the contact block', () =>
  assert.ok(detailTpl.includes('contact_block contact_number contact_role')));


// ---- report a room (grievance route required by the e-commerce rules) ----
console.log('report');
check('the message names the room and carries its link', () => {
  const m = KK.report.message('Single Room near AMDA', 'https://kothakhoj.com/place/12');
  assert.ok(m.includes('Single Room near AMDA'));
  assert.ok(m.includes('https://kothakhoj.com/place/12'));
});
check('missing name or link still produces a usable message', () => {
  const m = KK.report.message('', '');
  assert.ok(m.includes('this room'), m);
});
check('both channels are offered, WhatsApp and email', () => {
  const html = KK.report.blockHtml(12, 'A room');
  assert.ok(html.includes('wa.me/9779704452372'), 'whatsapp');
  assert.ok(html.includes('mailto:kothakhoj4@gmail.com'), 'email');
});
check('the room link points at the public site, not localhost', () => {
  // The link is carried inside the message body, so it arrives percent-encoded
  // in the href — decode before looking for it.
  const decoded = decodeURIComponent(KK.report.blockHtml(12, 'x'));
  assert.ok(decoded.includes('https://kothakhoj.com/place/12'), decoded.slice(0, 200));
  assert.ok(!decoded.includes('localhost') && !decoded.includes('127.0.0.1'));
});
check('a room name with quotes or html cannot break out of the link', () => {
  const html = KK.report.blockHtml(1, '<img src=x onerror=alert(1)>"');
  assert.ok(!html.includes('<img'), 'raw tag leaked into the markup');
  assert.ok(!/href="[^"]*"[^>]*onerror/.test(html), 'attribute broken out of');
});
check('report_block helper returns a SafeString', () => {
  const out = Handlebars.helpers.report_block(3, 'Room');
  assert.ok(String(out).includes('kk-report'));
});
check('detail template renders the report block', () => {
  const tpl = fs.readFileSync(path.join(FLAVOR, 'jstemplates/place-detail.html'), 'utf8');
  assert.ok(/report_block\s+id\s+name/.test(tpl));
});

// ---- business details page (e-commerce listing requirement) ----
console.log('business details page');
check('the page carries every detail the department asked for', () => {
  const biz = fs.readFileSync(path.join(FLAVOR, 'jstemplates/pages/business.html'), 'utf8');
  ['५२/०८३/०८४', '१५७५६४७२१', 'घरेलु तथा साना उद्योग कार्यालय',
   'अमनिगंज', '९७०४४५२३७२', 'kothakhoj4@gmail.com',
   'गुनासो सुनवाई गर्ने व्यक्ति'].forEach(needle =>
    assert.ok(biz.includes(needle), 'missing from the page: ' + needle));
});
check('the citizenship number is NOT published', () => {
  const biz = fs.readFileSync(path.join(FLAVOR, 'jstemplates/pages/business.html'), 'utf8');
  assert.ok(!biz.includes('३६-०१-८०-०५२००'), 'citizenship number leaked onto a public page');
});
check('the footer identifies the firm on every page', () => {
  const idx = fs.readFileSync(path.join(FLAVOR, 'templates/index.html'), 'utf8');
  assert.ok(idx.includes('firm-line'));
  assert.ok(idx.includes('/page/business'));
});
check('the page is declared so /page/business resolves', () => {
  const cfg = fs.readFileSync(path.join(FLAVOR, 'config.yml'), 'utf8');
  assert.ok(/slug:\s*business/.test(cfg));
  assert.ok(/name:\s*business/.test(cfg));
});

// ---- filter chip (bug: choosing a filter changed nothing on screen) ----
console.log('filter chip');
check('"all" is not a filter, so no chip', () => {
  assert.strictEqual(KK.filter.isActive('all'), false);
  assert.strictEqual(KK.filter.isActive(''), false);
  assert.strictEqual(KK.filter.isActive(undefined), false);
});
check('a real room type is a filter', () => {
  assert.strictEqual(KK.filter.isActive('single_room'), true);
  assert.strictEqual(KK.filter.isActive('flat'), true);
});
check('the chip shows the label and carries its own way out', () => {
  const html = KK.filter.html('Single Room');
  assert.ok(html.includes('Single Room'));
  assert.ok(html.includes('/filter/all'), 'no way to clear the filter');
});
check('a hostile label cannot break out of the chip', () => {
  const html = KK.filter.html('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'), 'raw tag leaked into the chip');
});
check('choosing a filter closes the nav page so the map is visible', () => {
  // The whole bug: the filter applied behind the open menu, so nothing
  // appeared to happen and the only way to see it was to press Back.
  const routes = fs.readFileSync(
    path.join(FLAVOR, '../../sa_web/static/js/routes.js'), 'utf8');
  const fn = routes.slice(routes.indexOf('filterMap: function'));
  assert.ok(/hidePanel\(\)/.test(fn.slice(0, 1200)), 'filterMap never closes the panel');
  assert.ok(/hasClass\('page'\)/.test(fn.slice(0, 1200)),
    'must only close a nav page - never the add-room form');
});
check('the filter change is announced so the map can draw the chip', () => {
  const routes = fs.readFileSync(
    path.join(FLAVOR, '../../sa_web/static/js/routes.js'), 'utf8');
  assert.ok(routes.includes('kk:filterchanged'));
});
check('the chip hides during the directions flow', () => {
  const css = fs.readFileSync(path.join(FLAVOR, 'static/css/custom.css'), 'utf8');
  assert.ok(/body\.kk-directions\s+\.kk-filter-chip\s*\{[^}]*display:\s*none/.test(css));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
