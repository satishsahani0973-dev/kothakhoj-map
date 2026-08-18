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

// ---- freeDate ----
console.log('freeDate');
const today = new Date(2026, 7, 8); // 8 Aug 2026, pinned so specs cannot rot
check('now -> empty values', () => {
  const r = KK.freeDate.compute('now', 3, today);
  assert.strictEqual(r.freeFrom, ''); assert.strictEqual(r.freeTs, '');
});
check('3 months -> 2026-11-08', () => assert.strictEqual(KK.freeDate.compute('month', 3, today).freeFrom, '2026-11-08'));
check('2 years -> 2028-08-08', () => assert.strictEqual(KK.freeDate.compute('year', 2, today).freeFrom, '2028-08-08'));
check('typed 7 months -> 2027-03-08', () => assert.strictEqual(KK.freeDate.compute('month', '7', today).freeFrom, '2027-03-08'));
check('freeTs matches freeFrom date', () => {
  const r = KK.freeDate.compute('month', 3, today);
  assert.strictEqual(Number(r.freeTs), new Date(2026, 10, 8).getTime());
});
check('clamp month 99 -> 11', () => assert.strictEqual(KK.freeDate.clamp('month', '99'), 11));
check('clamp year 99 -> 10', () => assert.strictEqual(KK.freeDate.clamp('year', '99'), 10));
check('clamp 0/-5/abc -> 1', () => {
  assert.strictEqual(KK.freeDate.clamp('month', '0'), 1);
  assert.strictEqual(KK.freeDate.clamp('month', '-5'), 1);
  assert.strictEqual(KK.freeDate.clamp('month', 'abc'), 1);
});

// ---- availability ----
console.log('availability');
const now = new Date(2026, 7, 8).getTime();
check('missing/empty/undefined-string -> now', () => {
  assert.strictEqual(KK.availability(undefined, now).state, 'now');
  assert.strictEqual(KK.availability('', now).state, 'now');
  assert.strictEqual(KK.availability('undefined', now).state, 'now');
});
check('past ts -> now', () => assert.strictEqual(KK.availability(String(now - 1000), now).state, 'now'));
check('future ts -> later with label', () => {
  const a = KK.availability(String(new Date(2026, 10, 8).getTime()), now);
  assert.strictEqual(a.state, 'later'); assert.ok(a.label.includes('2026'));
});

// ---- badge helper ----
console.log('free_badge helper');
check('green for legacy place', () => {
  const html = String(Handlebars.helpers.free_badge(undefined));
  assert.ok(html.includes('free-badge-now') && html.includes('Available now'));
});
check('orange for future date', () => {
  const html = String(Handlebars.helpers.free_badge(String(Date.now() + 86400000 * 90)));
  assert.ok(html.includes('free-badge-later') && html.includes('free from'));
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
check('four rules extracted from config', () => assert.strictEqual(rules.length, 4));

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

check('legacy place (no free_ts) -> green dot', () =>
  assert.ok(firstIcon({ layer: { focused: false } }).includes('dot-4bbd45')));
check('empty free_ts -> green dot', () =>
  assert.ok(firstIcon({ free_ts: '', layer: { focused: false } }).includes('dot-4bbd45')));
check('future free_ts -> orange dot', () =>
  assert.ok(firstIcon({ free_ts: String(Date.now() + 1000000), layer: { focused: false } }).includes('dot-f95016')));
check('past free_ts -> green dot (auto flip)', () =>
  assert.ok(firstIcon({ free_ts: String(Date.now() - 1000000), layer: { focused: false } }).includes('dot-4bbd45')));
check('focused + future -> big orange marker', () =>
  assert.ok(firstIcon({ free_ts: String(Date.now() + 1000000), layer: { focused: true } }).includes('marker-f95016')));
check('focused + available -> big green marker', () =>
  assert.ok(firstIcon({ layer: { focused: true } }).includes('marker-4bbd45')));

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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
