/*globals describe it expect KothaKhoj */

// Specs for the KothaKhoj flavor logic in flavors/satish/static/js/custom.js:
// the first-visit sign-in gate, the "When will this room be free?" date
// math, and the availability badge decision.

describe('KothaKhoj.gate.shouldShow', function() {
  var gate = window.KothaKhoj.gate;

  it('gates an anonymous first-time visitor on the map', function() {
    expect(gate.shouldShow(null, false, '/')).toBe(true);
    expect(gate.shouldShow(undefined, false, '/14/27.61997/83.45000')).toBe(true);
  });

  it('never gates a signed-in user', function() {
    expect(gate.shouldShow({username: 'butwal_campus'}, false, '/')).toBe(false);
  });

  it('asks only once per browser', function() {
    expect(gate.shouldShow(null, true, '/')).toBe(false);
  });

  it('never hijacks a shared place link', function() {
    expect(gate.shouldShow(null, false, '/place/123')).toBe(false);
  });
});

describe('KothaKhoj.freeDate', function() {
  var freeDate = window.KothaKhoj.freeDate;
  // Pin "today" so the specs cannot rot: 8 Aug 2026.
  var today = new Date(2026, 7, 8);

  it('returns empty values for "now"', function() {
    var r = freeDate.compute('now', 3, today);
    expect(r.freeFrom).toBe('');
    expect(r.freeTs).toBe('');
  });

  it('adds months', function() {
    var r = freeDate.compute('month', 3, today);
    expect(r.freeFrom).toBe('2026-11-08');
    expect(Number(r.freeTs)).toBe(new Date(2026, 10, 8).getTime());
    expect(r.n).toBe(3);
  });

  it('adds years', function() {
    var r = freeDate.compute('year', 2, today);
    expect(r.freeFrom).toBe('2028-08-08');
    expect(r.n).toBe(2);
  });

  it('accepts typed numbers beyond the chips', function() {
    var r = freeDate.compute('month', '7', today);
    expect(r.freeFrom).toBe('2027-03-08');
  });

  it('clamps nonsense input to the allowed range', function() {
    expect(freeDate.clamp('month', '99')).toBe(11);
    expect(freeDate.clamp('year', '99')).toBe(10);
    expect(freeDate.clamp('month', '0')).toBe(1);
    expect(freeDate.clamp('month', 'abc')).toBe(1);
    expect(freeDate.clamp('month', '-5')).toBe(1);
  });
});

describe('KothaKhoj.availability', function() {
  var availability = window.KothaKhoj.availability;
  var now = new Date(2026, 7, 8).getTime();

  it('reads a legacy place (no free_ts) as available', function() {
    expect(availability(undefined, now).state).toBe('now');
    expect(availability('', now).state).toBe('now');
    expect(availability('undefined', now).state).toBe('now');
  });

  it('reads a past date as available', function() {
    expect(availability(String(now - 1000), now).state).toBe('now');
  });

  it('reads a future date as occupied, with the date label', function() {
    var future = new Date(2026, 10, 8).getTime();
    var a = availability(String(future), now);
    expect(a.state).toBe('later');
    expect(a.label).toContain('2026');
  });
});
