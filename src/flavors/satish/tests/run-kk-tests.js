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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
