/*globals jQuery */
// KothaKhoj flavor behaviors, loaded after the app scripts on every page.
// Keep all flavor JS here: <script> tags inside jstemplates break the
// inline {% handlebarsjs %} embed in base.html.
(function($) {

  // Namespace for flavor logic; pure functions live here so Jasmine can
  // exercise them without a DOM or storage.
  var KK = window.KothaKhoj = window.KothaKhoj || {};

  // Escape before anything reaches an innerHTML string. Shared, because
  // several features build small chunks of markup by hand.
  KK.esc = function(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // ---- First-visit sign-in gate ------------------------------------------
  // Visitors who are not signed in and never chose "Continue browsing" get
  // the sign-in panel over a blurred map. Shared /place/ links skip the
  // gate so a student never loses a room someone sent them.
  KK.gate = {
    KEY: 'kk-gate-choice',

    // Pure decision: gate only anonymous visitors, only once, never on
    // shared place links.
    shouldShow: function(currentUser, choiceMade, pathname) {
      if (currentUser) { return false; }
      if (choiceMade) { return false; }
      if (/^\/place\//.test(pathname || '')) { return false; }
      return true;
    },

    choiceMade: function() {
      // Storage can throw in private mode; treat that as "never nag".
      try { return !!window.localStorage.getItem(KK.gate.KEY); }
      catch (e) { return true; }
    },

    rememberChoice: function() {
      try { window.localStorage.setItem(KK.gate.KEY, 'browsing'); } catch (e) {}
    },

    // Pure decision: may the blur be lifted? The gate dims and freezes the
    // map while the sign-in panel is open, so the blur must never outlive
    // the panel. It is only safe to lift once the panel has actually been
    // seen and has since gone away — otherwise we would clear the blur in
    // the instant between raising the gate and the panel rendering.
    shouldRelease: function(gateOn, panelVisible, panelSeen) {
      return !!(gateOn && panelSeen && !panelVisible);
    }
  };

  // ---- Nepali months ------------------------------------------------------
  // Bikram Sambat month starts, as AD dates. Generated from the
  // nepali-datetime library and cross-checked against a published
  // festival date (Ghatasthapana = Ashoj 25, 2083 = Sun 11 Oct 2026).
  // BS month lengths vary year to year and cannot be computed, so this
  // table is the only source of truth. It ends at 2029-11-16 — regenerate
  // before then, or 'Pick a month' quietly runs out of chips.
  KK.bsMonths = [
    { m: 'Bhadra', y: 2083, ad: '2026-08-17' },
    { m: 'Ashoj', y: 2083, ad: '2026-09-17' },
    { m: 'Kartik', y: 2083, ad: '2026-10-18' },
    { m: 'Mangsir', y: 2083, ad: '2026-11-17' },
    { m: 'Poush', y: 2083, ad: '2026-12-16' },
    { m: 'Magh', y: 2083, ad: '2027-01-15' },
    { m: 'Falgun', y: 2083, ad: '2027-02-13' },
    { m: 'Chaitra', y: 2083, ad: '2027-03-15' },
    { m: 'Baisakh', y: 2084, ad: '2027-04-14' },
    { m: 'Jestha', y: 2084, ad: '2027-05-15' },
    { m: 'Ashar', y: 2084, ad: '2027-06-15' },
    { m: 'Shrawan', y: 2084, ad: '2027-07-17' },
    { m: 'Bhadra', y: 2084, ad: '2027-08-17' },
    { m: 'Ashoj', y: 2084, ad: '2027-09-17' },
    { m: 'Kartik', y: 2084, ad: '2027-10-17' },
    { m: 'Mangsir', y: 2084, ad: '2027-11-16' },
    { m: 'Poush', y: 2084, ad: '2027-12-16' },
    { m: 'Magh', y: 2084, ad: '2028-01-14' },
    { m: 'Falgun', y: 2084, ad: '2028-02-13' },
    { m: 'Chaitra', y: 2084, ad: '2028-03-14' },
    { m: 'Baisakh', y: 2085, ad: '2028-04-13' },
    { m: 'Jestha', y: 2085, ad: '2028-05-14' },
    { m: 'Ashar', y: 2085, ad: '2028-06-15' },
    { m: 'Shrawan', y: 2085, ad: '2028-07-16' },
    { m: 'Bhadra', y: 2085, ad: '2028-08-17' },
    { m: 'Ashoj', y: 2085, ad: '2028-09-16' },
    { m: 'Kartik', y: 2085, ad: '2028-10-17' },
    { m: 'Mangsir', y: 2085, ad: '2028-11-16' },
    { m: 'Poush', y: 2085, ad: '2028-12-16' },
    { m: 'Magh', y: 2085, ad: '2029-01-14' },
    { m: 'Falgun', y: 2085, ad: '2029-02-13' },
    { m: 'Chaitra', y: 2085, ad: '2029-03-15' },
    { m: 'Baisakh', y: 2086, ad: '2029-04-14' },
    { m: 'Jestha', y: 2086, ad: '2029-05-14' },
    { m: 'Ashar', y: 2086, ad: '2029-06-15' },
    { m: 'Shrawan', y: 2086, ad: '2029-07-16' },
    { m: 'Bhadra', y: 2086, ad: '2029-08-17' },
    { m: 'Ashoj', y: 2086, ad: '2029-09-17' },
    { m: 'Kartik', y: 2086, ad: '2029-10-17' },
    { m: 'Mangsir', y: 2086, ad: '2029-11-16' }
  ];

  // Midnight in NEPAL of a 'YYYY-MM-DD' string.
  //
  // Deliberately not the device's local midnight. These dates name days on a
  // Nepali calendar, and the API stores free_ts as Nepal midnight, so the two
  // must be the same instant no matter where the phone is. Using the device
  // clock made a room set to Kartik read as "Ashoj" for every viewer behind
  // +05:45 — the whole of India included — because the stored timestamp fell
  // 15 minutes short of that device's idea of when Kartik began.
  //
  // Nepal has been a fixed +05:45 since 1986 with no DST, so a constant is
  // correct here and does not need a timezone database.
  KK.NPT_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
  KK.bsTs = function(iso) {
    var p = String(iso).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], 0, 0, 0, 0) - KK.NPT_OFFSET_MS;
  };

  // Which Nepali month does this moment fall in? Used for the badge, so a
  // room reads "Free from Kartik 2083" rather than "26 Nov 2026" — the
  // month name is what a student in Butwal actually plans around.
  // Falls back to the English date if the timestamp predates the table or
  // runs off its end, so a badge never renders blank.
  KK.bsLabel = function(ts) {
    var t = Number(ts);
    if (!t || isNaN(t)) { return ''; }
    for (var i = 0; i < KK.bsMonths.length; i++) {
      var startTs = KK.bsTs(KK.bsMonths[i].ad);
      if (startTs > t) { break; }
      // The month must actually CONTAIN the moment. Taking the last entry
      // that merely starts before it would label a date in 2099 with the
      // final row of the table, inventing a month we have no data for.
      var next = KK.bsMonths[i + 1];
      var endTs = next ? KK.bsTs(next.ad) : startTs + 32 * 86400000;
      if (t < endTs) { return KK.bsMonths[i].m + ' ' + KK.bsMonths[i].y; }
    }
    return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // The next `count` Nepali months that have not started yet. `from` is
  // injectable so tests can pin the clock.
  KK.bsUpcoming = function(count, from) {
    var now = (from || new Date()).getTime();
    var out = [];
    for (var i = 0; i < KK.bsMonths.length && out.length < (count || 8); i++) {
      var ts = KK.bsTs(KK.bsMonths[i].ad);
      if (ts > now) { out.push({ m: KK.bsMonths[i].m, y: KK.bsMonths[i].y, ad: KK.bsMonths[i].ad, ts: ts }); }
    }
    return out;
  };

  // ---- Active filter chip -------------------------------------------------
  // Choosing "Single Room" from the menu quietly hides most of the pins. The
  // app's own filter indicator is drawn INSIDE the nav menu, so it vanishes
  // when the menu closes — a student was left looking at a half-empty map
  // with no idea why, and no way back except finding the menu again.
  //
  // This chip sits on the map itself and carries its own way out.
  KK.filter = {
    // Pure: is this a real filter, or the "show everything" default?
    isActive: function(locationType) {
      return !!locationType && locationType !== 'all';
    },

    html: function(label) {
      return '<div class="kk-filter-chip">' +
        '<span class="kk-filter-chip-label">' + KK.esc(label) + '</span>' +
        '<a href="/filter/all" class="kk-filter-chip-clear" rel="internal" ' +
        'aria-label="Show all rooms">&times;</a>' +
        '</div>';
    },

    render: function(locationType, label) {
      var $host = $('#map');
      if (!$host.length) { return; }
      $('.kk-filter-chip').remove();
      if (!KK.filter.isActive(locationType)) { return; }
      $host.append(KK.filter.html(label || locationType));
    }
  };

  $(function() {
    $(window.Shareabouts || {}).on('kk:filterchanged', function(evt, locationType, label) {
      KK.filter.render(locationType, label);
    });
  });

  // ---- Report a room -----------------------------------------------------
  // The e-commerce listing rules require a working grievance route, and a
  // phone number on a page nobody reads is not one. This puts the complaint
  // one tap from the room being complained about, and carries the room's own
  // link so the report says WHICH room without the student having to explain.
  //
  // Both channels on purpose: WhatsApp is what students in Butwal actually
  // use, and email is the fallback when a call or message goes unanswered.
  KK.report = {
    NUMBER: '9779704452372',
    EMAIL: 'kothakhoj4@gmail.com',

    // Pure: the message body, so it can be tested without a DOM.
    message: function(name, url) {
      return 'KothaKhoj — गुनासो / Report a room\n\n' +
        'Room: ' + (name || 'this room') + '\n' +
        'Link: ' + (url || '') + '\n\n' +
        'What is wrong: ';
    },

    waHref: function(name, url) {
      return 'https://wa.me/' + KK.report.NUMBER +
        '?text=' + encodeURIComponent(KK.report.message(name, url));
    },

    mailHref: function(name, url) {
      return 'mailto:' + KK.report.EMAIL +
        '?subject=' + encodeURIComponent('KothaKhoj — report a room') +
        '&body=' + encodeURIComponent(KK.report.message(name, url));
    },

    blockHtml: function(id, name) {
      var url = 'https://kothakhoj.com/place/' + encodeURIComponent(id || '');
      return '<p class="kk-report">' +
        '<span class="kk-report-label">Room already taken, wrong rent, or not real?</span> ' +
        '<a class="kk-report-link" href="' + KK.esc(KK.report.waHref(name, url)) + '" ' +
        'target="_blank" rel="noopener noreferrer">Report on WhatsApp</a>' +
        '<span class="kk-report-or"> or </span>' +
        '<a class="kk-report-link" href="' + KK.esc(KK.report.mailHref(name, url)) + '">email us</a>' +
        '</p>';
    }
  };

  // ---- Availability badge -------------------------------------------------
  // Pure decision used by the detail page badge (and tests).
  //
  // free_state is AUTHORITATIVE and must be tested BEFORE free_ts. The
  // students who post rooms are the ones about to leave, and they do not
  // know their exam date — so "ask" is a real answer, stored with no
  // timestamp at all. Number('') is 0 and 0 <= now, so checking free_ts
  // first would quietly report every "ask" room as available now, which is
  // the exact 20-minute wasted walk this whole field exists to prevent.
  //
  // Places saved before this feature carry no free_state. If such a place
  // has a usable free_ts we trust it (the poster really did pick a date);
  // if it has neither, we know nothing about it and say so.
  KK.availability = function(free_ts, now, free_state) {
    now = now || Date.now();

    if (free_state === 'ask') { return { state: 'ask', label: '' }; }
    if (free_state === 'now') { return { state: 'now', label: '' }; }

    var ts = Number(free_ts);
    var usable = ts && !isNaN(ts);

    if (!usable) {
      // No date and no explicit answer: only legacy rows land here.
      return free_state === 'date' ?
        { state: 'ask', label: '' } :
        { state: KK.availability.LEGACY_EMPTY, label: '' };
    }
    // The month arriving flips the room green on its own.
    //
    // Deliberate, and Satish's call: the people who post these rooms are the
    // final-year students about to leave them, so the month is not a
    // bystander's guess — it is stated by the person walking out the door,
    // and anyone who does not know picks "Not sure yet" instead, which
    // stores no timestamp and never expires.
    //
    // The known risk, accepted for now: nobody revisits the room after that
    // date, so if the landlord re-lets it quickly the pin keeps saying
    // "Available now". Revisit if students start reporting rooms that were
    // already taken — the alternative is to stop trusting the date once it
    // is stale rather than to distrust it from the start.
    if (ts <= now) { return { state: 'now', label: '' }; }
    return { state: 'later', label: KK.bsLabel(ts) };
  };

  // A legacy place with no answer at all tells us nothing, so it fails
  // toward "go ask" rather than toward "walk across town".
  KK.availability.LEGACY_EMPTY = 'ask';

  // ---- Directions logic ---------------------------------------------------
  // Pure decisions for the routing feature (map-view.js reads these): which
  // travel mode fits the trip, the "850 m · 12 min" summary line, and when
  // the walker has actually arrived at the room.
  KK.route = {
    MODES: ['walking', 'cycling', 'driving'],

    // A remembered choice wins (walking only while the trip stays walkable);
    // otherwise short trips walk and everything else drives.
    pickProfile: function(straightMeters, preferred) {
      if (KK.route.MODES.indexOf(preferred) !== -1 &&
          (preferred !== 'walking' || straightMeters <= 8000)) {
        return preferred;
      }
      return straightMeters <= 3000 ? 'walking' : 'driving';
    },

    fmtSummary: function(meters, seconds) {
      var dist = meters < 950 ?
        (Math.round(meters / 10) * 10) + ' m' :
        (meters / 1000).toFixed(1) + ' km';
      var mins = Math.max(1, Math.round(seconds / 60));
      var time = mins < 60 ?
        mins + ' min' :
        Math.floor(mins / 60) + 'h ' + ('0' + (mins % 60)).slice(-2) + 'min';
      return dist + ' · ' + time;
    },

    isArrived: function(metersToDest) { return metersToDest <= 30; },

    // Which turn comes next. Each instruction carries the index of the
    // route coordinate where its maneuver happens, so the next turn is the
    // first one still ahead of where the walker currently is. Past the last
    // maneuver we keep showing it (it is the "arrive" step).
    nextInstruction: function(instructions, positionIndex) {
      if (!instructions || !instructions.length) { return null; }
      for (var i = 0; i < instructions.length; i++) {
        if (instructions[i].index >= positionIndex) { return instructions[i]; }
      }
      return instructions[instructions.length - 1];
    },

    // The lead-in under a turn: "now" when it is on top of you, otherwise
    // a rounded distance a walker can judge by eye.
    fmtStepDistance: function(meters) {
      if (!isFinite(meters) || meters < 20) { return 'now'; }
      if (meters < 950) { return 'in ' + (Math.round(meters / 10) * 10) + ' m'; }
      return 'in ' + (meters / 1000).toFixed(1) + ' km';
    },

    // "9812345678" / "09812345678" / "+977 981-2345678" -> a wa.me link;
    // null when there aren't enough digits to be a phone number.
    waLink: function(contact) {
      var digits = String(contact == null ? '' : contact).replace(/[^0-9]/g, '');
      digits = digits.replace(/^0+/, '').replace(/^977/, '');
      if (digits.length < 9) { return null; }
      return 'https://wa.me/977' + digits;
    }
  };

  // ---- Owner contact ------------------------------------------------------
  // The form records whose number was given (Owner / Other person); the
  // detail page then names who the caller reaches and offers a WhatsApp
  // shortcut. Places saved before this feature carry no role, so they keep
  // a neutral "Contact" label — same information as before.
  KK.contact = {
    // Kept as an alias so existing callers and tests are undisturbed.
    esc: function(s) { return KK.esc(s); },
    roleLabel: function(role) {
      if (role === 'owner') { return 'Owner'; }
      if (role === 'other') { return 'Contact person'; }
      return 'Contact';
    },

    // A dialable href, normalised the same way as the WhatsApp link so the
    // two buttons never disagree about which number they reach. Returns
    // null for anything too short to be a Nepali mobile, which is also what
    // keeps a half-typed number from rendering a dead button.
    telHref: function(number) {
      var digits = String(number == null ? '' : number).replace(/[^0-9]/g, '');
      digits = digits.replace(/^0+/, '').replace(/^977/, '');
      if (digits.length < 9) { return null; }
      return 'tel:+977' + digits;
    },

    blockHtml: function(number, role) {
      var num = String(number == null ? '' : number).trim();
      if (!num) { return ''; }
      var label = KK.contact.roleLabel(role);
      var wa = KK.route.waLink(num);
      var tel = KK.contact.telHref(num);
      var html = '<div class="place-item kk-contact">' +
        '<span class="place-label">' + label + '</span>' +
        '<p class="place-value kk-contact-number">' + KK.contact.esc(num) + '</p>';
      // Call comes FIRST and WhatsApp second. Most rooms on this map are
      // occupied, so the number is the product: the student rings from
      // where he is sitting instead of walking the lanes. Plenty of Butwal
      // landlords are not on WhatsApp at all, and the ones who are still
      // answer a call faster than a message from a stranger.
      if (tel) {
        html += '<a class="btn kk-call-btn" href="' + tel +
                '">Call the ' + label.toLowerCase() + '</a>';
      }
      if (wa) {
        html += '<a class="btn kk-wa-btn" target="_blank" rel="noopener" href="' + wa +
                '">WhatsApp the ' + label.toLowerCase() + '</a>';
      }
      return html + '</div>';
    }
  };

  if (window.Handlebars) {
    // Called as {{ free_badge free_ts free_state }}. Handlebars always
    // appends its own options object, so when a template passes only one
    // argument free_state arrives as that object — ignore anything that is
    // not a string rather than letting it masquerade as a state.
    window.Handlebars.registerHelper('free_badge', function(free_ts, free_state) {
      var state = typeof free_state === 'string' ? free_state : undefined;
      var a = KK.availability(free_ts, null, state);
      var html;
      if (a.state === 'now') {
        html = '<span class="free-badge free-badge-now">Available now</span>';
      } else if (a.state === 'ask') {
        // Deliberately not "unknown" or "no date": it states the fact the
        // poster actually verified with their own eyes, and tells the
        // reader what to do about it. "Ask" alone was an order with no
        // object — a student read it as "go and knock", which is the walk
        // across town this field exists to prevent, while a call button
        // sat directly underneath.
        html = '<span class="free-badge free-badge-ask">Someone lives here now — call and ask</span>';
      } else {
        html = '<span class="free-badge free-badge-later">Free from ' + a.label + '</span>';
      }
      return new window.Handlebars.SafeString(html);
    });
    window.Handlebars.registerHelper('contact_block', function(number, role) {
      return new window.Handlebars.SafeString(KK.contact.blockHtml(number, role));
    });
    window.Handlebars.registerHelper('report_block', function(id, name) {
      var n = typeof name === 'string' ? name : '';
      return new window.Handlebars.SafeString(KK.report.blockHtml(id, n));
    });
  }

  $(function() {
    var user = window.Shareabouts && window.Shareabouts.bootstrapped &&
               window.Shareabouts.bootstrapped.currentUser;
    if (!KK.gate.shouldShow(user, KK.gate.choiceMade(), window.location.pathname)) { return; }

    $('body').addClass('signin-gate');
    // The router (window.app) is created in a later ready handler, so wait
    // one tick before navigating to the sign-in panel.
    setTimeout(function() {
      if (window.app) {
        window.app.navigate('page/signin', {trigger: true});
      } else {
        $('body').removeClass('signin-gate');
      }
    }, 0);
  });

  // The panel can also be dismissed without touching our buttons — Android's
  // Back button and any route change close it — and until this watcher the
  // blur stayed behind, leaving a map that looked fine but could not be
  // panned, zoomed or tapped, with a reload just repeating the trap.
  $(function() {
    var panelSeen = false;
    var release = function() {
      var $body = $('body');
      if (!KK.gate.shouldRelease($body.hasClass('signin-gate'),
                                 $body.hasClass('content-visible'),
                                 panelSeen)) { return; }
      KK.gate.rememberChoice();
      $body.removeClass('signin-gate');
    };
    var sync = function() {
      if ($('body').hasClass('content-visible')) {
        panelSeen = true;
      } else {
        // The camera must not outlive the panel either. Closing the sign-in
        // panel with ✕, Back, or a route change used to leave the rear
        // camera held and a decode loop running four times a second.
        stopScanner(null);
      }
      release();
    };
    if (window.MutationObserver) {
      new window.MutationObserver(sync).observe(document.body, {
        attributes: true, attributeFilter: ['class']
      });
    }
    // Belt and braces for browsers without MutationObserver, and for the
    // Back button specifically.
    $(window).on('popstate hashchange', function() { setTimeout(sync, 0); });
  });

  // Closing the gate panel in any way counts as "continue browsing":
  // the panel's Continue button and the pink ✕ both carry .close-btn.
  $(document).on('click', 'body.signin-gate .close-btn', function() {
    KK.gate.rememberChoice();
    $('body').removeClass('signin-gate');
  });

  // ---- Location engine ----------------------------------------------------
  // One GPS engine for the whole site: the My Location button and the
  // add-place flow share it. It watches the GPS for a few seconds (readings
  // sharpen fast), keeps the best fix, draws the familiar blue dot +
  // accuracy circle, then stops to save battery.
  KK.geo = {
    REFINE_MS: 5000,
    FRESH_MS: 2 * 60 * 1000,
    GOOD_ACCURACY_M: 50,
    lastFix: null,

    // Pure: is a stored fix still fresh enough to reuse without asking GPS?
    isFresh: function(fix, now) {
      if (!fix || !fix.ts) { return false; }
      return ((now || Date.now()) - fix.ts) < KK.geo.FRESH_MS;
    },

    // Pure: 'good' means trust it; 'weak' means tell the person to drag.
    quality: function(accuracy) {
      return (typeof accuracy === 'number' && accuracy <= KK.geo.GOOD_ACCURACY_M) ? 'good' : 'weak';
    },

    _dot: null,
    _circle: null,
    _watchId: null,

    drawFix: function(map, fix) {
      var L = window.L;
      var latlng = [fix.lat, fix.lng];
      if (!KK.geo._dot) {
        KK.geo._circle = L.circle(latlng, {
          radius: fix.accuracy,
          color: '#1a73e8', weight: 1.5, opacity: 0.35,
          fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false
        }).addTo(map);
        KK.geo._dot = L.circleMarker(latlng, {
          radius: 6, color: '#fff', weight: 2.5,
          fillColor: '#1a73e8', fillOpacity: 1, interactive: false
        }).addTo(map);
      } else {
        KK.geo._circle.setLatLng(latlng).setRadius(fix.accuracy);
        KK.geo._dot.setLatLng(latlng);
      }
    },

    stop: function() {
      if (KK.geo._watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(KK.geo._watchId);
        KK.geo._watchId = null;
      }
    },

    // locate(map, {onFirst, onDone, onError}): onFirst fires on the first
    // reading (move the map now), onDone fires with the BEST fix after the
    // refine window, onError with a human message.
    locate: function(map, opts) {
      opts = opts || {};
      if (!navigator.geolocation) {
        if (opts.onError) { opts.onError('This phone or browser has no location support. Just drag the map — that works too.'); }
        return;
      }
      KK.geo.stop();
      var best = null;
      var gotFirst = false;

      KK.geo._watchId = navigator.geolocation.watchPosition(function(pos) {
        var fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 9999),
          ts: Date.now()
        };
        if (!best || fix.accuracy <= best.accuracy) { best = fix; }
        KK.geo.lastFix = best;
        KK.geo.drawFix(map, best);
        if (!gotFirst) {
          gotFirst = true;
          if (opts.onFirst) { opts.onFirst(best); }
          // Close the watch after the refine window, keeping the best fix.
          setTimeout(function() {
            KK.geo.stop();
            if (opts.onDone) { opts.onDone(best); }
          }, KK.geo.REFINE_MS);
        }
      }, function(err) {
        KK.geo.stop();
        var message = err && err.code === 1 ?
          'Location is refused for this site. Turn it on in your phone settings, or just drag the map — that works too.' :
          'Your location could not be found. Just drag the map — that works too.';
        if (opts.onError) { opts.onError(message); }
      }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    }
  };

  // ---- "Use my current location" in the add-place flow --------------------
  // The status box sits next to the form (not inside the <form> element),
  // so target it directly — only one add-place screen exists at a time.
  function setLocationStatus(kind, html) {
    $('.use-location-status')
      .removeClass('is-hidden good weak')
      .addClass(kind)
      .html(html);
    $('.use-location-hint').addClass('is-hidden');
  }

  function currentMap() {
    var app = window.app;
    return app && app.appView && app.appView.mapView && app.appView.mapView.map;
  }

  function applyFixToForm(fix, isAuto) {
    var map = currentMap();
    if (!map) { return; }
    map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17));
    KK.geo.drawFix(map, fix);
    // Tell the app the pin is set here, same as the My Location hook does.
    $(window.Shareabouts).trigger('userlocated', [window.L.latLng(fix.lat, fix.lng)]);

    var q = KK.geo.quality(fix.accuracy);
    if (q === 'good') {
      // Step 1 ticks itself: green ✓ and a short inline note.
      $('.form-step-where .step-dot').addClass('done').html('✓');
      $('.form-step-where .form-step-note').text('— pin set, within ~' + fix.accuracy + ' m. Drag to adjust.');
      $('.use-location-status').addClass('is-hidden');
    } else {
      $('.form-step-where .form-step-note').text('');
      setLocationStatus('weak',
        '<strong>GPS is only sure within ~' + fix.accuracy + ' m here.</strong><br>' +
        'Please drag the map to the exact building.');
    }
    $('.use-location-btn').prop('disabled', false).text('Find me again');
  }

  $(document).on('click', '.use-location-btn', function() {
    var $btn = $(this);
    var map = currentMap();
    if (!map) { return; }
    $btn.prop('disabled', true).text('Finding you…');
    KK.geo.locate(map, {
      onFirst: function(fix) { map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17)); },
      onDone: function(fix) { applyFixToForm(fix, false); },
      onError: function(message) {
        setLocationStatus('weak', message);
        $btn.prop('disabled', false).text('Use my current location');
      }
    });
  });

  // When the add-place form opens and we already have a fresh fix, start
  // the pin on the poster automatically — zero taps.
  $(function() {
    $(window.Shareabouts).on('panelshow', function(evt, router, fragment) {
      if (fragment !== 'place/new') { return; }
      if (KK.geo.isFresh(KK.geo.lastFix)) {
        setTimeout(function() { applyFixToForm(KK.geo.lastFix, true); }, 150);
      }
    });
  });

  // ---- First-open auto-fit ------------------------------------------------
  // On a plain open (no /place/ link, no coordinates in the URL), frame the
  // map around the listings once they load: right zoom for every screen,
  // valley only, hills ignored. The user's own dragging always wins.
  // One stray faraway pin must not zoom the whole map out, so we frame the
  // dense cluster: pins within MAX_KM of the median point.
  KK.fit = {
    MAX_KM: 10,

    // Pure: [[lat, lng], ...] -> the pins near the median point. With fewer
    // than 3 pins there is no "cluster" to speak of; keep them all.
    cluster: function(points) {
      if (!points || points.length < 3) { return points || []; }
      var lats = points.map(function(p) { return p[0]; }).sort(function(a, b) { return a - b; });
      var lngs = points.map(function(p) { return p[1]; }).sort(function(a, b) { return a - b; });
      var mid = Math.floor(points.length / 2);
      var mlat = lats[mid], mlng = lngs[mid];
      var kmPerDegLat = 111;
      var kmPerDegLng = 111 * Math.cos(mlat * Math.PI / 180);
      var keep = points.filter(function(p) {
        var dLat = (p[0] - mlat) * kmPerDegLat;
        var dLng = (p[1] - mlng) * kmPerDegLng;
        return Math.sqrt(dLat * dLat + dLng * dLng) <= KK.fit.MAX_KM;
      });
      return keep.length ? keep : points;
    }
  };
  $(function() {
    setTimeout(function() {
      var app = window.app;
      var map = currentMap();
      if (!app || !map || !window.Backbone) { return; }
      var fragment = window.Backbone.history.getFragment() || '';
      if (/^(place\/|list|\d)/.test(fragment)) { return; }

      var userMoved = false;
      map.once('dragstart', function() { userMoved = true; });
      $(document).one('click', '.leaflet-control-zoom a', function() { userMoved = true; });

      var lastCount = -1;
      var tries = 0;
      var timer = setInterval(function() {
        tries++;
        if (userMoved || tries > 24) { clearInterval(timer); return; }
        var coll = app.collection;
        var count = coll ? coll.length : 0;
        if (count > 0 && count === lastCount) {
          clearInterval(timer);
          var latlngs = [];
          coll.each(function(model) {
            var g = model.get('geometry');
            if (g && g.coordinates && g.type === 'Point') {
              latlngs.push([g.coordinates[1], g.coordinates[0]]);
            }
          });
          latlngs = KK.fit.cluster(latlngs);
          if (latlngs.length && !userMoved) {
            map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 16 });
          }
        }
        lastCount = count;
      }, 500);
    }, 0);
  });

  // ---- QR login card scanner ---------------------------------------------
  // The same card works two ways: a phone camera opens the /qr/<secret>
  // link directly, and this in-panel scanner reads the same link with the
  // webcam. We never navigate to the scanned URL itself — only the secret
  // is extracted and sent to OUR /qr/ door, so a malicious QR can't send
  // anyone to a strange website.
  KK.qr = {
    // Pure: decoded QR text -> secret token, or null if it isn't a login card.
    extractToken: function(text) {
      text = String(text || '');
      var m = text.match(/\/qr\/([A-Za-z0-9_-]{16,})/);
      if (m) { return m[1]; }
      if (/^[A-Za-z0-9_-]{16,}$/.test(text.trim())) { return text.trim(); }
      return null;
    }
  };

  var scannerStream = null;

  function stopScanner($panel) {
    if (scannerStream) {
      scannerStream.getTracks().forEach(function(track) { track.stop(); });
      scannerStream = null;
    }
    // Callers that just want the camera off (a panel closing) need not know
    // which panel it was.
    if (!$panel || !$panel.length) { $panel = $('.signin-page'); }
    $panel.find('.signin-scanner').addClass('is-hidden');
    $panel.find('.signin-scan').removeClass('is-hidden');
  }

  function scanLoop(video, $panel) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    function tick() {
      if (!scannerStream) { return; }
      if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var code = window.jsQR(image.data, image.width, image.height);
        var token = code && KK.qr.extractToken(code.data);
        if (token) {
          stopScanner($panel);
          window.location = '/qr/' + token;
          return;
        }
      }
      setTimeout(tick, 250);
    }
    tick();
  }

  $(document).on('click', '.signin-scan', function() {
    var $panel = $(this).closest('.signin-page');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Camera is not available here. Scan the card with your phone camera instead, or type your username and password.');
      return;
    }
    var staticUrl = (window.Shareabouts && window.Shareabouts.bootstrapped &&
                     window.Shareabouts.bootstrapped.staticUrl) || '/static/';
    $.getScript(staticUrl + 'libs/jsQR.js').always(function() {
      if (!window.jsQR) {
        alert('Could not start the scanner. Please type your username and password.');
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function(stream) {
          scannerStream = stream;
          var video = $panel.find('.signin-scanner-video')[0];
          video.srcObject = stream;
          video.play();
          $panel.find('.signin-scan').addClass('is-hidden');
          $panel.find('.signin-scanner').removeClass('is-hidden');
          scanLoop(video, $panel);
        })
        .catch(function() {
          alert('Camera permission was refused. Scan the card with your phone camera instead, or type your username and password.');
        });
    });
  });

  $(document).on('click', '.signin-scanner-cancel', function() {
    stopScanner($(this).closest('.signin-page'));
  });

  // ---- Login card from the gallery ----------------------------------------
  // Many students have a photo of their card (WhatsApp, screenshot) rather
  // than the printed card in hand. Same safety rule as the webcam scanner:
  // only the token is extracted; we never open the QR's own URL.
  $(document).on('click', '.signin-scan-file', function() {
    $(this).closest('.signin-page').find('.signin-scan-input').trigger('click');
  });
  $(document).on('change', '.signin-scan-input', function() {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) { return; }
    var staticUrl = (window.Shareabouts && window.Shareabouts.bootstrapped &&
                     window.Shareabouts.bootstrapped.staticUrl) || '/static/';
    $.getScript(staticUrl + 'libs/jsQR.js').always(function() {
      if (!window.jsQR) {
        alert('Could not read the photo. Please type your username and password.');
        return;
      }
      var img = new Image();
      img.onload = function() {
        var scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var code = window.jsQR(image.data, image.width, image.height);
        var token = code && KK.qr.extractToken(code.data);
        URL.revokeObjectURL(img.src);
        if (token) {
          window.location = '/qr/' + token;
        } else {
          alert('No login card found in that photo. Try a clearer, closer photo of the QR.');
        }
      };
      img.onerror = function() { alert('Could not open that photo.'); };
      img.src = URL.createObjectURL(file);
    });
  });


  // A failed sign-in or a dead QR card leaves a short-lived flash cookie:
  // open the sign-in panel and show the problem inline, with a WhatsApp
  // door for anyone who is stuck.
  var WHATSAPP_URL = 'https://wa.me/9779704452372?text=' +
    encodeURIComponent('Hello KothaKhoj, I need help signing in.');

  function popFlash(name) {
    if (!(new RegExp('(?:^|;\\s*)' + name + '=').test(document.cookie))) { return false; }
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    return true;
  }

  function injectSigninError(message) {
    var $page = $('.signin-page');
    if (!$page.length) { return; }
    $page.find('.signin-error').remove();
    $('<div class="signin-error"></div>')
      .text(message)
      .append('<br><a class="btn signin-whatsapp" target="_blank" rel="noopener" href="' +
              WHATSAPP_URL + '">Message us on WhatsApp</a>')
      .prependTo($page);
  }

  function showSigninProblem(message) {
    setTimeout(function() {
      if (window.app) { window.app.navigate('page/signin', {trigger: true}); }
      // The panel renders synchronously on navigate; a short beat later is
      // safe to put the banner on top of it.
      setTimeout(function() { injectSigninError(message); }, 150);
    }, 0);
  }

  // Submit the sign-in form in the background: a wrong password shows the
  // error instantly in the open panel — no full map reload. Only a correct
  // password reloads the page (to boot the signed-in state).
  $(document).on('submit', '.signin-form', function(e) {
    e.preventDefault();
    var $form = $(this);
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) { $form.find('input[name="csrfmiddlewaretoken"]').val(m[1]); }

    var $btn = $form.find('.signin-submit');
    $btn.prop('disabled', true).data('label', $btn.text()).text('Signing in…');

    $.ajax({ url: '/login/', method: 'POST', data: $form.serialize() })
      .done(function() { window.location.href = '/'; })
      .fail(function() {
        $btn.prop('disabled', false).text($btn.data('label') || 'Sign in');
        injectSigninError('Wrong username or password. Please try again.');
      });
  });

  $(function() {
    if (popFlash('login-error')) {
      showSigninProblem('Wrong username or password. Please try again.');
    } else if (popFlash('qr-error')) {
      showSigninProblem('This login card is not valid anymore. Ask KothaKhoj for a new one, or sign in with your username and password.');
    }
  });

  // ---- College markers + campus areas ------------------------------------
  // Colleges come from the same published Google Sheet the search box uses
  // (columns: name, lat, lng, aliases — edit the sheet, never this file).
  // Each college gets a small dark cap marker, a name chip from zoom 13,
  // and a light dashed circle approximating the campus area, so rooms
  // (green/orange pins) stay the loudest thing on the map.
  var COLLEGES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgmcyTZFZwmOXuMdam-su8Zq-GIs42qhJXS0G-jmZ6Fi9MUfQseKakGXKiH2ATNvrn2ESTQE1aGRvj/pub?gid=0&single=true&output=csv';
  var COLLEGE_LABEL_MIN_ZOOM = 13;
  var CAMPUS_RADIUS_METERS = 300;

  KK.colleges = {
    // CSV text -> rows of fields, honouring the quoting the sheet actually
    // emits: a quoted field may contain commas, doubled quotes, and even
    // newlines.
    //
    // This used to be a plain split(','). Every college whose name contains
    // a comma - "Institute of Forestry, Pokhara Campus" - is published by
    // Google as a QUOTED field, so the naive split put the second half of
    // the name into the lat column. Those colleges lost their pin here, and
    // the search box (which had no coordinate check) kept them with a NaN
    // position, so choosing one handed Leaflet an invalid LatLng and killed
    // the click. One comma in one name broke search for the whole map.
    rows: function(text) {
      var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
      var rows = [], row = [], field = '', quoted = false;
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (quoted) {
          if (c !== '"') { field += c; }
          else if (s.charAt(i + 1) === '"') { field += '"'; i++; }
          else { quoted = false; }
        } else if (c === '"') { quoted = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
        else { field += c; }
      }
      if (field !== '' || row.length) { row.push(field); rows.push(row); }
      return rows.filter(function(r) {
        return r.some(function(f) { return String(f).trim() !== ''; });
      });
    },

    // Pure: CSV text -> [{name, lat, lng}], dropping rows without a name or
    // with unusable coordinates. That check also skips a repeated header
    // row, which the sheet has picked up once before.
    parseCsv: function(text) {
      var rows = KK.colleges.rows(text);
      if (rows.length < 2) { return []; }
      var headers = rows[0].map(function(h) { return String(h).trim().toLowerCase(); });
      var out = [];
      for (var i = 1; i < rows.length; i++) {
        var cols = rows[i], row = {};
        headers.forEach(function(h, idx) {
          row[h] = String(cols[idx] == null ? '' : cols[idx]).trim();
        });
        var lat = parseFloat(row.lat), lng = parseFloat(row.lng);
        if (row.name && isFinite(lat) && isFinite(lng)) {
          out.push({ name: row.name, lat: lat, lng: lng });
        }
      }
      return out;
    }
  };

  function addCollegeLayer(map, colleges) {
    var L = window.L;
    var group = L.layerGroup();

    // Campus circles are hidden by default (they clutter areas where
    // schools sit close together). Tapping a college shows only that
    // college's circle; tapping it again — or another college — hides it.
    var activeCircle = null;

    colleges.forEach(function(college) {
      var circle = L.circle([college.lat, college.lng], {
        radius: CAMPUS_RADIUS_METERS,
        color: '#534AB7',
        weight: 1.5,
        dashArray: '6 4',
        opacity: 0.45,
        fillColor: '#534AB7',
        fillOpacity: 0.10,
        interactive: false
      });

      var marker = L.marker([college.lat, college.lng], {
        icon: L.divIcon({
          className: 'college-div-icon',
          html: '<span class="college-marker">🎓</span>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        }),
        keyboard: false
      });
      marker.bindTooltip(college.name, {
        permanent: true,
        direction: 'right',
        offset: [12, 0],
        className: 'college-label'
      });
      marker.on('click', function() {
        var wasActive = (activeCircle === circle);
        if (activeCircle) {
          map.removeLayer(activeCircle);
          activeCircle = null;
        }
        if (!wasActive) {
          circle.addTo(map);
          activeCircle = circle;
        }
        map.setView([college.lat, college.lng], Math.max(map.getZoom(), 15));
      });
      marker.addTo(group);
    });

    group.addTo(map);

    var $container = $(map.getContainer());
    function syncLabels() {
      $container.toggleClass('hide-college-labels', map.getZoom() < COLLEGE_LABEL_MIN_ZOOM);
    }
    map.on('zoomend', syncLabels);
    syncLabels();
  }

  $(function() {
    // The app (and its Leaflet map) is created in a later ready handler.
    setTimeout(function() {
      var app = window.app;
      var map = app && app.appView && app.appView.mapView && app.appView.mapView.map;
      if (!map || !window.L) { return; }
      $.get(COLLEGES_CSV_URL).done(function(text) {
        var colleges = KK.colleges.parseCsv(text);
        if (colleges.length) { addCollegeLayer(map, colleges); }
      });
    }, 0);
  });

  // ---- Availability legend ------------------------------------------------
  // Small stacked card at the bottom-left of the map telling first-time
  // visitors what the pin colors mean. Wording mirrors the detail badge
  // ("Available" / "Not available"); dot colors match the config.yml
  // marker icons.
  KK.legend = {
    html: function() {
      // "Free later" rather than "Not available": a parent reads "not
      // available" as gone and stops looking. The blue row exists because
      // green used to mean both "this room is empty" and "nobody answered
      // the question", which is the same pixel for two different facts.
      return '<div class="kk-legend">' +
        '<div class="kk-legend-row"><span class="kk-legend-dot kk-legend-dot-free"></span>Available now</div>' +
        '<div class="kk-legend-row"><span class="kk-legend-dot kk-legend-dot-taken"></span>Free later</div>' +
        '<div class="kk-legend-row"><span class="kk-legend-dot kk-legend-dot-ask"></span>Someone lives here — call and ask</div>' +
        '</div>';
    }
  };

  $(function() {
    // Same one-tick wait as the college layer: the map exists only after
    // the app's own ready handler has run.
    setTimeout(function() {
      var app = window.app;
      var map = app && app.appView && app.appView.mapView && app.appView.mapView.map;
      if (!map) { return; }
      $(map.getContainer()).append(KK.legend.html());
    }, 0);
  });

  // ---- "When will the room be free?" picker -------------------------------
  // Three choices in one row: Free now / Not sure yet / Pick a month.
  //
  // "Not sure yet" is the DEFAULT, and it is a real answer rather than a
  // failure to answer. The people who post rooms are the students about to
  // leave them, and they genuinely do not know when they go: exam routines
  // in Nepal are published a few weeks out and move, results take months,
  // and health students stay on afterwards for the licence exam. Asking
  // them to turn all that into a number was asking for a guess, and a guess
  // on this field sends someone walking to a room that is already taken.
  //
  // The form stores three values: free_state (now | ask | date) which is
  // authoritative, free_from (YYYY-MM-DD) for humans, and free_ts (epoch
  // ms) for the map colour rules. free_ts is strictly numeric-or-empty —
  // the state never rides inside it.
  KK.freeDate = {
    // Pure: what to store for a chosen answer. `choice` is 'now', 'ask',
    // or one of the entries from KK.bsUpcoming().
    compute: function(choice) {
      if (choice === 'ask') {
        // No timestamp at all. There is nothing to flip, and a month
        // nobody chose must never turn a pin green on its own.
        return { state: 'ask', freeFrom: '', freeTs: '', label: '' };
      }
      if (!choice || choice === 'now') {
        return { state: 'now', freeFrom: '', freeTs: '', label: '' };
      }
      return {
        state: 'date',
        freeFrom: choice.ad,
        freeTs: String(KK.bsTs(choice.ad)),
        label: choice.m + ' ' + choice.y
      };
    }
  };

  // Fill the month row with the next Nepali months. Rendered from the BS
  // table rather than the device clock, because BS month lengths vary year
  // to year and cannot be derived.
  function renderMonthChips($picker) {
    var $wrap = $picker.find('.free-month-chips');
    if (!$wrap.length || $wrap.children().length) { return; }
    var months = KK.bsUpcoming(8);
    var html = months.map(function(mo, i) {
      return '<button type="button" class="btn free-month" data-i="' + i + '">' +
        KK.esc(mo.m) + '</button>';
    }).join('');
    $wrap.html(html).data('months', months);
  }

  function writeFree($picker, result) {
    $picker.find('input[name="free_state"]').val(result.state);
    $picker.find('input[name="free_from"]').val(result.freeFrom);
    $picker.find('input[name="free_ts"]').val(result.freeTs);
  }

  function refreshFreePicker($picker) {
    var kind = $picker.find('.free-kind.is-active').data('kind') || 'ask';
    var $months = $picker.find('.free-picker-months');
    var $date = $picker.find('.free-picker-date');
    var $preview = $picker.find('.free-picker-preview');
    var $note = $picker.find('.free-picker-note');

    if (kind === 'now') {
      $months.addClass('is-hidden');
      $date.addClass('is-hidden');
      $note.addClass('is-hidden');
      writeFree($picker, KK.freeDate.compute('now'));
      $preview.html('Students will see: <span class="free-badge free-badge-now">Available now</span>');
      return;
    }

    if (kind === 'ask') {
      $months.addClass('is-hidden');
      $date.addClass('is-hidden');
      writeFree($picker, KK.freeDate.compute('ask'));
      $preview.html('Students will see: <span class="free-badge free-badge-ask">Someone lives here now — call and ask</span>');
      // Says out loud that the room is still listed. Without this the
      // honest answer feels like the one that gets you nothing.
      $note.removeClass('is-hidden');
      return;
    }

    renderMonthChips($picker);
    $months.removeClass('is-hidden');
    $note.addClass('is-hidden');

    var months = $picker.find('.free-month-chips').data('months') || [];
    var $active = $picker.find('.free-month.is-active');
    if (!$active.length) {
      // Month mode with nothing picked yet is not an answer, so hold the
      // stored value at "ask" until they actually choose one.
      $date.addClass('is-hidden');
      writeFree($picker, KK.freeDate.compute('ask'));
      $preview.html('Students will see: <span class="free-badge free-badge-ask">Someone lives here now — call and ask</span>');
      return;
    }

    var chosen = months[Number($active.data('i'))];
    var result = KK.freeDate.compute(chosen);
    $date.removeClass('is-hidden').text('Free from the start of ' + result.label + '.');
    $preview.html('Students will see: <span class="free-badge free-badge-later">Free from ' +
      KK.esc(result.label) + '</span>');
    writeFree($picker, result);
  }

  $(document).on('click', '.free-picker .free-kind', function() {
    var $picker = $(this).closest('.free-picker');
    $picker.find('.free-kind').removeClass('is-active');
    $(this).addClass('is-active');
    // Switching away from the month row clears the month, so the previous
    // choice cannot linger under a different answer.
    if ($(this).data('kind') !== 'date') {
      $picker.find('.free-month').removeClass('is-active');
    }
    refreshFreePicker($picker);
  });

  $(document).on('click', '.free-picker .free-month', function() {
    var $picker = $(this).closest('.free-picker');
    $picker.find('.free-month').removeClass('is-active');
    $(this).addClass('is-active');
    refreshFreePicker($picker);
  });

  // The sign-in panel form posts to Django, which needs the CSRF token the
  // map page set as a cookie. Fill it just before the POST leaves.
  $(document).on('submit', '.signin-form', function() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) { $(this).find('input[name="csrfmiddlewaretoken"]').val(m[1]); }
  });

  // ---- Device-bound ownership for shared accounts ------------------------
  // One login may be shared by many people (a college account). Each
  // browser keeps a random secret token; places created here carry it in a
  // private field, and the server refuses edits/deletes on a device-bound
  // place unless the same token comes back. deviceRules decides when the
  // Delete button is even offered; the server is the real lock.
  KK.deviceToken = (function() {
    try {
      var token = window.localStorage.getItem('kkDeviceToken');
      if (!token) {
        var bytes = new Uint8Array(20);
        window.crypto.getRandomValues(bytes);
        token = Array.prototype.map.call(bytes, function(b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
        window.localStorage.setItem('kkDeviceToken', token);
      }
      return token;
    } catch (e) { return null; }
  })();

  KK.deviceRules = {
    // Device-bound place: only the creating device may delete (and the
    // account must still match). Unbound place: the pre-existing
    // account-or-legacy-token rules apply unchanged.
    canDelete: function(deviceBound, ownedByAccount, isMine, ownedByToken) {
      if (deviceBound) { return !!(ownedByAccount && isMine); }
      return !!(ownedByAccount || ownedByToken);
    },
    // "Yours" highlight follows the same device rule as Delete — mirrors
    // S.Util.isMyPlace so the map never marks a place this device can't
    // manage.
    isMine: function(deviceBound, inMyList, legacyTokenMatch) {
      if (deviceBound) { return !!inMyList; }
      return !!(legacyTokenMatch || inMyList);
    }
  };

  if (KK.deviceToken) {
    // Send the token on every same-origin API call so the proxy can pass
    // it through to the API for PUT/PATCH/DELETE verification.
    $(document).ajaxSend(function(evt, xhr, settings) {
      var url = (settings && settings.url) || '';
      if (url.indexOf('/api') === 0) {
        xhr.setRequestHeader('X-Shareabouts-Device-Token', KK.deviceToken);
      }
    });

    // Stamp new places with this device's token (private field — the API
    // never exposes private-* data publicly). The public device_bound marker
    // is what makes the UI hide Delete on other devices, so it goes on ONLY
    // for shared logins — the server applies the same rule (it checks
    // User.is_shared_account). Marking every place bound made the map
    // stricter than the server and cost ordinary landlords the Delete button
    // on their own rooms whenever they signed in elsewhere or cleared their
    // browser data.
    var S = window.Shareabouts;
    var kkUser = S && S.bootstrapped && S.bootstrapped.currentUser;
    var kkSharedAccount = !!(kkUser && kkUser.is_shared_account);
    if (S && S.PlaceFormView) {
      var kkOrigGetAttrs = S.PlaceFormView.prototype.getAttrs;
      S.PlaceFormView.prototype.getAttrs = function() {
        var attrs = kkOrigGetAttrs.apply(this, arguments);
        attrs['private-device_token'] = KK.deviceToken;
        if (kkSharedAccount) { attrs['device_bound'] = true; }
        return attrs;
      };
    }
  }

})(jQuery);
