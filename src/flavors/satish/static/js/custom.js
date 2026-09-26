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

  // ---- A question you can read -------------------------------------------
  // The browser's own confirm() is a full-height black slab on Android Chrome
  // with the buttons wherever it decides to put them, and not one thing about
  // it can be styled. This asks the same question in a card that fits.
  //
  // Returns a promise for true/false. Callers must therefore be async, which
  // is the one real cost of leaving confirm() behind.
  //
  // The card is appended to <body> and NEVER inside #content. #content
  // carries z-index 10, which starts its own stacking context, so anything
  // fixed inside it is stacked against its siblings rather than against the
  // site header - that is exactly what painted the header over the camera
  // overlay. Attaching to body avoids the whole question.
  function openDialog(opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var done = false;
      function finish(answer) {
        if (done) { return; }
        done = true;
        $(document).off('keydown.kkdialog');
        $back.remove();
        resolve(answer);
      }

      var $back = $('<div class="kk-dialog-backdrop"></div>');
      var $card = $('<div class="kk-dialog" role="dialog" aria-modal="true"></div>');
      // An alert usually has nothing to put in a heading: the message IS the
      // content, and "Error" above it tells nobody anything.
      if (opts.title) {
        $card.append($('<h2 class="kk-dialog-title"></h2>').text(opts.title));
      }
      if (opts.body) {
        // .text(), not .html(): the body names the room, and a room name is
        // whatever somebody typed into the form.
        $card.append($('<p class="kk-dialog-body"></p>').text(opts.body));
      }
      var $row = $('<div class="kk-dialog-buttons"></div>');
      var $cancel = null;
      if (!opts.hideCancel) {
        $cancel = $('<button type="button" class="btn kk-dialog-cancel"></button>')
          .text(opts.cancelText || 'Cancel');
        $row.append($cancel);
      }
      var $ok = $('<button type="button" class="btn kk-dialog-ok"></button>')
        .text(opts.okText || 'OK');
      if (opts.danger) { $ok.addClass('kk-dialog-danger'); }
      $row.append($ok);
      $card.append($row);
      $back.append($card);

      if ($cancel) { $cancel.on('click', function() { finish(false); }); }
      $ok.on('click', function() { finish(true); });
      // Tapping the dark area is a cancel, the way every sheet on a phone
      // behaves. Clicks inside the card must not count.
      $back.on('click', function(e) { if (e.target === $back[0]) { finish(false); } });
      $(document).on('keydown.kkdialog', function(e) {
        if (e.key === 'Escape' || e.keyCode === 27) { finish(false); }
      });

      $('body').append($back);
      // Focus the safe button, not the destructive one: a stray Enter should
      // never be what deletes somebody's room. An alert has only the one.
      ($cancel || $ok).focus();
    });
  }

  KK.confirm = function(opts) { return openDialog(opts); };

  // One button, for something that has already happened and only needs
  // acknowledging. Takes a plain string as well, because most callers have
  // nothing to say but the message.
  KK.alert = function(opts) {
    if (typeof opts === 'string') { opts = { body: opts }; }
    opts = opts || {};
    return openDialog({
      title: opts.title || '',
      body: opts.body || '',
      okText: opts.okText || 'OK',
      hideCancel: true
    });
  };

  // ---- A message that does not stop you ----------------------------------
  // "Link copied" is not a question and not a failure. Answering a success
  // with a modal you have to dismiss is worse than the success is good, so
  // this says it and gets out of the way. No buttons, no focus stealing, and
  // pointer-events none so it can never swallow a tap meant for the map.
  var toastTimer = null;
  KK.toast = function(message) {
    var $t = $('.kk-toast');
    if (!$t.length) {
      $t = $('<div class="kk-toast" role="status" aria-live="polite"></div>');
      $('body').append($t);
    }
    $t.text(String(message == null ? '' : message)).addClass('is-showing');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function() { $t.removeClass('is-showing'); }, 2600);
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
  // Bikram Sambat month starts, as AD dates. BS month lengths vary from year
  // to year and cannot be computed, so a table is the only way.
  //
  // THIS IS A COPY. The original lives in the API repo, in
  // sa_api_v2/availability.py (BS_MONTH_STARTS), and the API is what writes
  // free_ts onto a place. If the two ever disagree, a room reads as one month
  // here and another there. Regenerate from that table rather than editing
  // rows by hand; kk-tests checks the two still match whenever both repos are
  // checked out side by side.
  //
  // Cross-checked against a published festival date: Ghatasthapana 2083 =
  // Ashoj 25 = Sunday 11 Oct 2026, 24 days after the Ashoj 1 below.
  // Covers 2026-08-17 to 2039-03-16. kk-tests starts failing well
  // before that runs out, so this does not have to be remembered.
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
    { m: 'Mangsir', y: 2086, ad: '2029-11-16' },
    { m: 'Poush', y: 2086, ad: '2029-12-16' },
    { m: 'Magh', y: 2086, ad: '2030-01-14' },
    { m: 'Falgun', y: 2086, ad: '2030-02-13' },
    { m: 'Chaitra', y: 2086, ad: '2030-03-15' },
    { m: 'Baisakh', y: 2087, ad: '2030-04-14' },
    { m: 'Jestha', y: 2087, ad: '2030-05-15' },
    { m: 'Ashar', y: 2087, ad: '2030-06-15' },
    { m: 'Shrawan', y: 2087, ad: '2030-07-17' },
    { m: 'Bhadra', y: 2087, ad: '2030-08-17' },
    { m: 'Ashoj', y: 2087, ad: '2030-09-17' },
    { m: 'Kartik', y: 2087, ad: '2030-10-18' },
    { m: 'Mangsir', y: 2087, ad: '2030-11-17' },
    { m: 'Poush', y: 2087, ad: '2030-12-16' },
    { m: 'Magh', y: 2087, ad: '2031-01-15' },
    { m: 'Falgun', y: 2087, ad: '2031-02-14' },
    { m: 'Chaitra', y: 2087, ad: '2031-03-16' },
    { m: 'Baisakh', y: 2088, ad: '2031-04-15' },
    { m: 'Jestha', y: 2088, ad: '2031-05-15' },
    { m: 'Ashar', y: 2088, ad: '2031-06-15' },
    { m: 'Shrawan', y: 2088, ad: '2031-07-17' },
    { m: 'Bhadra', y: 2088, ad: '2031-08-18' },
    { m: 'Ashoj', y: 2088, ad: '2031-09-17' },
    { m: 'Kartik', y: 2088, ad: '2031-10-18' },
    { m: 'Mangsir', y: 2088, ad: '2031-11-17' },
    { m: 'Poush', y: 2088, ad: '2031-12-17' },
    { m: 'Magh', y: 2088, ad: '2032-01-15' },
    { m: 'Falgun', y: 2088, ad: '2032-02-14' },
    { m: 'Chaitra', y: 2088, ad: '2032-03-15' },
    { m: 'Baisakh', y: 2089, ad: '2032-04-14' },
    { m: 'Jestha', y: 2089, ad: '2032-05-14' },
    { m: 'Ashar', y: 2089, ad: '2032-06-15' },
    { m: 'Shrawan', y: 2089, ad: '2032-07-16' },
    { m: 'Bhadra', y: 2089, ad: '2032-08-17' },
    { m: 'Ashoj', y: 2089, ad: '2032-09-17' },
    { m: 'Kartik', y: 2089, ad: '2032-10-17' },
    { m: 'Mangsir', y: 2089, ad: '2032-11-16' },
    { m: 'Poush', y: 2089, ad: '2032-12-16' },
    { m: 'Magh', y: 2089, ad: '2033-01-14' },
    { m: 'Falgun', y: 2089, ad: '2033-02-13' },
    { m: 'Chaitra', y: 2089, ad: '2033-03-15' },
    { m: 'Baisakh', y: 2090, ad: '2033-04-14' },
    { m: 'Jestha', y: 2090, ad: '2033-05-14' },
    { m: 'Ashar', y: 2090, ad: '2033-06-15' },
    { m: 'Shrawan', y: 2090, ad: '2033-07-16' },
    { m: 'Bhadra', y: 2090, ad: '2033-08-17' },
    { m: 'Ashoj', y: 2090, ad: '2033-09-17' },
    { m: 'Kartik', y: 2090, ad: '2033-10-17' },
    { m: 'Mangsir', y: 2090, ad: '2033-11-16' },
    { m: 'Poush', y: 2090, ad: '2033-12-16' },
    { m: 'Magh', y: 2090, ad: '2034-01-14' },
    { m: 'Falgun', y: 2090, ad: '2034-02-13' },
    { m: 'Chaitra', y: 2090, ad: '2034-03-15' },
    { m: 'Baisakh', y: 2091, ad: '2034-04-14' },
    { m: 'Jestha', y: 2091, ad: '2034-05-15' },
    { m: 'Ashar', y: 2091, ad: '2034-06-15' },
    { m: 'Shrawan', y: 2091, ad: '2034-07-17' },
    { m: 'Bhadra', y: 2091, ad: '2034-08-17' },
    { m: 'Ashoj', y: 2091, ad: '2034-09-17' },
    { m: 'Kartik', y: 2091, ad: '2034-10-18' },
    { m: 'Mangsir', y: 2091, ad: '2034-11-17' },
    { m: 'Poush', y: 2091, ad: '2034-12-17' },
    { m: 'Magh', y: 2091, ad: '2035-01-15' },
    { m: 'Falgun', y: 2091, ad: '2035-02-14' },
    { m: 'Chaitra', y: 2091, ad: '2035-03-16' },
    { m: 'Baisakh', y: 2092, ad: '2035-04-15' },
    { m: 'Jestha', y: 2092, ad: '2035-05-15' },
    { m: 'Ashar', y: 2092, ad: '2035-06-15' },
    { m: 'Shrawan', y: 2092, ad: '2035-07-17' },
    { m: 'Bhadra', y: 2092, ad: '2035-08-18' },
    { m: 'Ashoj', y: 2092, ad: '2035-09-18' },
    { m: 'Kartik', y: 2092, ad: '2035-10-18' },
    { m: 'Mangsir', y: 2092, ad: '2035-11-17' },
    { m: 'Poush', y: 2092, ad: '2035-12-17' },
    { m: 'Magh', y: 2092, ad: '2036-01-15' },
    { m: 'Falgun', y: 2092, ad: '2036-02-14' },
    { m: 'Chaitra', y: 2092, ad: '2036-03-15' },
    { m: 'Baisakh', y: 2093, ad: '2036-04-14' },
    { m: 'Jestha', y: 2093, ad: '2036-05-14' },
    { m: 'Ashar', y: 2093, ad: '2036-06-15' },
    { m: 'Shrawan', y: 2093, ad: '2036-07-16' },
    { m: 'Bhadra', y: 2093, ad: '2036-08-17' },
    { m: 'Ashoj', y: 2093, ad: '2036-09-17' },
    { m: 'Kartik', y: 2093, ad: '2036-10-17' },
    { m: 'Mangsir', y: 2093, ad: '2036-11-16' },
    { m: 'Poush', y: 2093, ad: '2036-12-16' },
    { m: 'Magh', y: 2093, ad: '2037-01-14' },
    { m: 'Falgun', y: 2093, ad: '2037-02-13' },
    { m: 'Chaitra', y: 2093, ad: '2037-03-15' },
    { m: 'Baisakh', y: 2094, ad: '2037-04-14' },
    { m: 'Jestha', y: 2094, ad: '2037-05-15' },
    { m: 'Ashar', y: 2094, ad: '2037-06-15' },
    { m: 'Shrawan', y: 2094, ad: '2037-07-17' },
    { m: 'Bhadra', y: 2094, ad: '2037-08-17' },
    { m: 'Ashoj', y: 2094, ad: '2037-09-17' },
    { m: 'Kartik', y: 2094, ad: '2037-10-17' },
    { m: 'Mangsir', y: 2094, ad: '2037-11-16' },
    { m: 'Poush', y: 2094, ad: '2037-12-16' },
    { m: 'Magh', y: 2094, ad: '2038-01-14' },
    { m: 'Falgun', y: 2094, ad: '2038-02-13' },
    { m: 'Chaitra', y: 2094, ad: '2038-03-15' },
    { m: 'Baisakh', y: 2095, ad: '2038-04-14' },
    { m: 'Jestha', y: 2095, ad: '2038-05-15' },
    { m: 'Ashar', y: 2095, ad: '2038-06-15' },
    { m: 'Shrawan', y: 2095, ad: '2038-07-17' },
    { m: 'Bhadra', y: 2095, ad: '2038-08-17' },
    { m: 'Ashoj', y: 2095, ad: '2038-09-17' },
    { m: 'Kartik', y: 2095, ad: '2038-10-18' },
    { m: 'Mangsir', y: 2095, ad: '2038-11-17' },
    { m: 'Poush', y: 2095, ad: '2038-12-16' },
    { m: 'Magh', y: 2095, ad: '2039-01-15' },
    { m: 'Falgun', y: 2095, ad: '2039-02-14' },
    { m: 'Chaitra', y: 2095, ad: '2039-03-16' },
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

  // ---- "I am taking this room" -------------------------------------------
  // A student taps this, the room comes off the map for a few hours, and
  // somebody rings the owner to find out whether it really went. The hold
  // buys that phone call without four more students ringing the same owner
  // in the meantime.
  //
  // Deliberately TWO taps. The likeliest way this feature goes wrong is not
  // an attacker - it is a curious student tapping to see what happens and
  // taking a real room off a map that has two rooms on it. The second tap is
  // where the consequence is spelled out, and it is also the only place the
  // phone number is asked for.
  //
  // Nothing here decides anything. The server picks the deadline, and the
  // server decides whether a hold is allowed at all; this code shows what it
  // answered. See Place.request_claim_hold in the api.
  KK.claim = {
    TEXT: {
      start:   'म यो कोठा लिँदैछु · I am taking this room',
      why:     'We will take this room off the map for a few hours and ring the owner to check it has really gone. That way nobody else walks across town for it.',
      phone:   'Your number (optional) — so we can tell you what the owner said',
      go:      'Yes, take it off the map',
      cancel:  'Not yet',
      done:    'Done. This room is off the map while we ring the owner.',
      failed:  'Could not reach KothaKhoj. Check your connection and try again.'
    },

    blockHtml: function(id, visible) {
      // A room already off the map has nothing to hold. Rendering the button
      // there would offer an action that can only ever be refused.
      if (visible === false) { return ''; }
      return '<div class="kk-claim" data-place-id="' + KK.esc(id || '') + '">' +
        '<button type="button" class="btn btn-block kk-claim-start">' +
          KK.esc(KK.claim.TEXT.start) + '</button>' +
        '</div>';
    },

    confirmHtml: function() {
      return '<div class="kk-claim-confirm">' +
        '<p class="kk-claim-why">' + KK.esc(KK.claim.TEXT.why) + '</p>' +
        '<label class="kk-claim-phone-label" for="kk-claim-phone">' +
          KK.esc(KK.claim.TEXT.phone) + '</label>' +
        '<input id="kk-claim-phone" class="kk-claim-phone" type="tel" ' +
          'inputmode="numeric" autocomplete="tel" maxlength="32" placeholder="98........">' +
        '<button type="button" class="btn btn-block kk-claim-go">' +
          KK.esc(KK.claim.TEXT.go) + '</button>' +
        '<button type="button" class="btn btn-block kk-claim-cancel">' +
          KK.esc(KK.claim.TEXT.cancel) + '</button>' +
        '</div>';
    },

    // Resolves to {granted: bool, message: string}. Never rejects: a student
    // on a bad connection near AMDA should be told to try again, not left
    // looking at a button that did nothing.
    //
    // Built on an explicit Deferred rather than .then(done, fail), and that
    // is not style. This site ships jQuery 1.10, where a fail filter passed
    // to .then returns a promise that is STILL REJECTED - the returned value
    // is filtered, not converted. (jQuery 3 changed this to match Promises/A+
    // and would have made the shorter version work.) With .then, every
    // refusal left the button disabled and showing "...", because the
    // caller's success handler never ran. A refusal is the common case here:
    // "someone else is already asking about this room" is a normal answer.
    post: function(id, phone) {
      var done = window.jQuery.Deferred();
      window.jQuery.ajax({
        url: '/api/places/' + encodeURIComponent(id) + '/claim',
        type: 'POST',
        contentType: 'application/json',
        dataType: 'json',
        data: JSON.stringify({ phone: phone || '' })
      }).done(function() {
        done.resolve({ granted: true, message: KK.claim.TEXT.done });
      }).fail(function(xhr) {
        var body = null;
        try { body = JSON.parse((xhr && xhr.responseText) || ''); }
        catch (e) { body = null; }
        done.resolve({
          granted: false,
          message: (body && body.message) || KK.claim.TEXT.failed
        });
      });
      return done.promise();
    }
  };

  // ---- Room photos --------------------------------------------------------
  // The swiping itself is CSS scroll-snap and needs nothing from here. This
  // only adds the counter and the dots, and only when there is more than one
  // photo - a "1 / 1" badge and a single dot are noise that tell a student
  // nothing.
  //
  // Everything below is an ENHANCEMENT. If it throws, never runs, or the
  // browser is too old, the strip still scrolls and every photo is still
  // reachable, which is why the markup carries no dots of its own.
  KK.photos = {
    // Which photo is showing, from a scroll position. Uses the real measured
    // width of the first slide rather than a constant, because the slide is
    // sized in per cent and the panel width changes with the phone.
    indexFor: function(scrollLeft, slideWidth, count) {
      if (!slideWidth || slideWidth <= 0 || !count) { return 0; }
      var i = Math.round(scrollLeft / slideWidth);
      return Math.max(0, Math.min(count - 1, i));
    },

    enhance: function(root) {
      var $root = $(root);
      if (!$root.length || $root.data('kkPhotosReady')) { return; }
      var strip = $root.find('.kk-photos-strip')[0];
      var slides = $root.find('.kk-photo');
      var count = slides.length;
      if (!strip || count < 2) { return; }
      $root.data('kkPhotosReady', true);

      var $count = $('<div class="kk-photos-count" aria-hidden="true"></div>')
        .text('1 / ' + count).appendTo($root);

      var $dots = $('<div class="kk-photos-dots"></div>');
      for (var i = 0; i < count; i++) {
        $('<button type="button" class="kk-photos-dot"></button>')
          .attr('aria-label', 'Photo ' + (i + 1) + ' of ' + count)
          .attr('data-index', i)
          .appendTo($dots);
      }
      $dots.appendTo($root);
      $dots.find('.kk-photos-dot').eq(0).addClass('is-active');

      function slideWidth() {
        var r = slides[0].getBoundingClientRect();
        // The gap counts: without it the computed index drifts by a whole
        // photo somewhere around the fifth one.
        var gap = parseFloat($(strip).css('column-gap') || $(strip).css('gap') || 0) || 0;
        return r.width + gap;
      }

      function sync() {
        var i = KK.photos.indexFor(strip.scrollLeft, slideWidth(), count);
        $count.text((i + 1) + ' / ' + count);
        $dots.find('.kk-photos-dot').removeClass('is-active').eq(i).addClass('is-active');
      }

      // rAF-throttled: a swipe fires scroll events far faster than the screen
      // redraws, and doing this work on every one of them is what makes a
      // cheap phone feel like it is dragging treacle.
      var ticking = false;
      $(strip).on('scroll', function() {
        if (ticking) { return; }
        ticking = true;
        window.requestAnimationFrame(function() { ticking = false; sync(); });
      });

      $dots.on('click', '.kk-photos-dot', function() {
        strip.scrollLeft = slideWidth() * (+$(this).attr('data-index') || 0);
      });
    }
  };

  // The detail panel is re-rendered by Marionette on every navigation, so the
  // enhancement cannot be bound once at startup - it has to run whenever a
  // panel appears.
  //
  // A MutationObserver, NOT a timer. The first version of this polled every
  // 400ms for the life of the page, which is a selector query and a loop
  // running for ever on a phone that is mostly showing a static panel - the
  // same "work on every tick" mistake the college labels were rewritten to
  // avoid. The observer costs nothing until the DOM actually changes, which
  // is exactly when there might be a new strip to enhance.
  //
  // enhance() is idempotent (it marks the node with .data('kkPhotosReady')),
  // so being called more than once for the same strip is free.
  $(function() {
    var root = document.getElementById('content') || document.body;

    function scan() {
      $('.kk-photos').each(function() { KK.photos.enhance(this); });
    }

    if (window.MutationObserver) {
      // Coalesce a burst of mutations into one pass: rendering a panel fires
      // many, and enhancing on each would do the same work dozens of times.
      var queued = false;
      new window.MutationObserver(function() {
        if (queued) { return; }
        queued = true;
        window.setTimeout(function() { queued = false; scan(); }, 50);
      }).observe(root, { childList: true, subtree: true });
    }
    scan();
  });

  // ---- Rent ---------------------------------------------------------------
  // Everything in a place's data blob is TEXT, so this has to read a string
  // first and a number second, or every real room falls through to null and
  // the rent never appears.
  //
  // Silence on anything unusable is deliberate. Rooms posted before the field
  // existed carry no rent, and a room that says "Rs NaN" or "Rs undefined"
  // looks broken in a way that makes a student distrust the whole map. No
  // line at all just looks like a room whose owner did not say.
  //
  // Grouped in threes (3,500 / 12,000). The lakh grouping would only differ
  // above 99,999, which is not a student room in Butwal.
  KK.rent = {
    parse: function(value) {
      var digits = (typeof value === 'string' && /^\d+$/.test(value))
        ? parseInt(value, 10)
        : (typeof value === 'number' && isFinite(value) ? Math.round(value) : null);
      if (digits === null || digits <= 0) { return null; }
      return digits;
    },

    format: function(value) {
      var n = KK.rent.parse(value);
      if (n === null) { return null; }
      return 'Rs ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    // The compact form a map pin carries. Same number, no "Rs", because on a
    // pin every character costs width and there is nothing else it could be.
    pinLabel: function(value) {
      var n = KK.rent.parse(value);
      if (n === null) { return null; }
      if (n >= 1000) {
        var k = n / 1000;
        return (k % 1 === 0 ? k : k.toFixed(1)) + 'k';
      }
      return String(n);
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

  // ---- what to say when a required field is empty ------------------------
  // The browser already blocks the submit - both fields carry `required`, and
  // place-form-view.js binds 'submit', so native validation runs first. What
  // it says is "Please fill out this field", in the BROWSER's language, which
  // tells a student nothing about why the field is there.
  //
  // These replace the text and keep the native machinery. Each one says what
  // to do and what it costs to skip, because "required" is an assertion about
  // our form and "nobody can reach you" is a fact about their room.
  KK.validationMessage = function(name, validity) {
    if (!validity) { return ''; }

    if (name === 'contact_number') {
      // No valueMissing branch: the number went back to optional on
      // 2026-09-21, so an empty one is a valid answer and the browser never
      // reports it missing. If it is ever made compulsory again, add the
      // branch back here AND the `required` attr in config.yml - neither
      // works alone, and `optional: true` enforces nothing either way.
      if (validity.patternMismatch || validity.tooShort) {
        return 'That does not look like a Nepali mobile number. It should be ' +
          '10 digits starting 98, 97 or 96.';
      }
    }

    if (name === 'location_type' && validity.valueMissing) {
      return 'Choose the room type - single room, double room or flat.';
    }

    // Anything else keeps the browser's own wording. A half-translated form
    // reads worse than a consistent one.
    return '';
  };

  // ---- "only you can see this" ------------------------------------------
  // A hidden room is still listed for the person who posted it (the API
  // returns their own invisible places). Without this line they open their
  // room, see it looking completely normal, and have no idea it is off the
  // map - so they either worry it is broken, or assume it is live and wonder
  // why nobody calls.
  //
  // Two different hidden states, and they must not read the same:
  //   they hid it themselves, until a date -> say WHEN it comes back
  //   somebody else hid it (moderation)    -> do NOT promise a date,
  //                                           because none is coming
  KK.hiddenNotice = function(visible, hideUntilFree, freeTs, now) {
    if (visible !== false) { return ''; }
    if (hideUntilFree) {
      var ts = Number(freeTs);
      if (ts && !isNaN(ts) && ts > (now || Date.now())) {
        return 'Only you can see this room. It appears on the map on ' +
          KK.bsLabel(ts) + '.';
      }
      // Marker set but the date has gone, or was never usable. The nightly
      // sweep releases these; say something true meanwhile rather than
      // naming a date that has already passed.
      return 'Only you can see this room. It will appear on the map shortly.';
    }
    return 'Only you can see this room. It is not on the map.';
  };

  // ---- Dead shared links --------------------------------------------------
  // A room link gets pasted into a WhatsApp group and lives there for weeks.
  // By the time someone taps it the room is often gone, and until now the app
  // answered by silently bouncing them to the map - which reads as "your link
  // is broken" or "this site does not work", not as "that room went".
  //
  // The status code is the whole decision, because Backbone's error callback
  // fires for everything: 404, 500, a timeout, a phone with no signal. Only a
  // 404 means the room is not there. Anything else means WE could not answer,
  // and saying "someone took it" then is a lie that costs a real listing a
  // real viewer. Unknown or missing status falls to the honest branch, not the
  // confident one.
  //
  // A room hidden by hide-until-free is a 404 to everyone but its poster, so
  // it lands here too, deliberately. We cannot tell hidden from deleted from
  // out here - and we should not, because saying "this one is only hidden"
  // would undo the privacy the poster chose. "Someone is in it" is true of
  // both anyway.
  KK.deadLinkNotice = function(status) {
    if (Number(status) === 404) {
      return {
        taken: true,
        np: 'यो कोठा कसैले लिइसक्यो',
        en: 'This room is already taken.'
      };
    }
    return {
      taken: false,
      np: 'कोठा खोल्न सकिएन',
      en: 'Could not open this room. Check your connection and try again.'
    };
  };

  // The panel itself. Nepali first - the people tapping these links are
  // students in Nepal - with the English under it, the way the business page
  // already does it.
  KK.deadLinkHtml = function(status) {
    var n = KK.deadLinkNotice(status);
    return '<div class="kk-dead-link' + (n.taken ? ' kk-dead-link-taken' : '') + '">' +
      '<h2 class="kk-dead-link-np">' + KK.esc(n.np) + '</h2>' +
      '<p class="kk-dead-link-en">' + KK.esc(n.en) + '</p>' +
      '<a href="/" class="btn btn-primary kk-dead-link-browse">' +
      KK.esc('अरू कोठा हेर्नुहोस् / See other rooms') + '</a>' +
      '</div>';
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
    },

    // Google's travel modes are not our profile names.
    GMAPS_MODE: { walking: 'walking', cycling: 'bicycling', driving: 'driving' },

    // Hand the walk over to Google Maps.
    //
    // Why hand it over at all, when this app already routes: a browser tab
    // cannot survive a locked screen. A student walking fifteen minutes to a
    // room WILL lock the phone, take a call, or switch to WhatsApp, and the
    // moment they do, watchPosition stops and the route is gone - leaving
    // them in a gali looking at a blank screen. Google Maps keeps running,
    // keeps talking, and has far better coverage of Butwal's lanes than the
    // OSM data our Mapbox profile routes on.
    //
    // No origin is passed. Maps uses the phone's own location, which is
    // better than anything we could hand it.
    //
    // The mode is picked the same way the in-app route picks it, from the
    // last GPS fix if we have a fresh one. Hardcoding 'walking' would hand
    // someone a two-hour walk on the one listing that is across town; with
    // no fix at all, walking is still the right default, because every room
    // on this map is in one small town.
    gmapsLink: function(lat, lng, straightMeters, preferred) {
      var la = Number(lat), ln = Number(lng);
      if (!isFinite(la) || !isFinite(ln)) { return null; }
      var profile = (typeof straightMeters === 'number' && isFinite(straightMeters))
        ? KK.route.pickProfile(straightMeters, preferred)
        : 'walking';
      return 'https://www.google.com/maps/dir/?api=1' +
             '&destination=' + encodeURIComponent(la + ',' + ln) +
             '&travelmode=' + (KK.route.GMAPS_MODE[profile] || 'walking');
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

  // ---- Address line -------------------------------------------------------
  // The lane and the house number, printed as ONE line under the landmark.
  //
  // Both are optional and usually only one is known - Butwal runs on lanes
  // and landmarks, and plenty of houses have no number anyone can tell you.
  // So every combination has to read properly on its own, and an empty pair
  // must produce NOTHING rather than an empty element: the detail panel has
  // no :empty rule (the ones in default.css are scoped to .place-list), so a
  // stray wrapper would leave a blank gap under every title.
  KK.address = {
    lineHtml: function(path, house) {
      var p = String(path == null ? '' : path).trim();
      var h = String(house == null ? '' : house).trim();
      var parts = [];
      if (p) { parts.push(KK.esc(p)); }
      // "House" is written out because a bare number beside a lane name reads
      // as part of the lane.
      if (h) { parts.push('House ' + KK.esc(h)); }
      if (!parts.length) { return ''; }
      return '<p class="place-address-line">' + parts.join(', ') + '</p>';
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
    window.Handlebars.registerHelper('address_line', function(path, house) {
      // Handlebars appends its own options object, so a template that passes
      // only one argument would hand that object in as `house`. Anything that
      // is not a string is treated as absent.
      var p = typeof path === 'string' ? path : '';
      var h = typeof house === 'string' ? house : '';
      return new window.Handlebars.SafeString(KK.address.lineHtml(p, h));
    });
    window.Handlebars.registerHelper('hidden_notice', function(visible, hideUntilFree, freeTs) {
      // Handlebars appends its options object as the last argument, so any
      // value arriving as an object is a MISSING argument, not a value.
      var v = (typeof visible === 'boolean') ? visible : true;
      var h = (typeof hideUntilFree === 'string') ? hideUntilFree : '';
      var t = (typeof freeTs === 'string' || typeof freeTs === 'number') ? freeTs : '';
      var text = KK.hiddenNotice(v, h, t);
      if (!text) { return ''; }
      return new window.Handlebars.SafeString(
        '<p class="place-hidden-notice">' + KK.esc(text) + '</p>');
    });
    window.Handlebars.registerHelper('claim_block', function(id, visible) {
      // Handlebars appends its options object last, so a non-boolean
      // `visible` means the argument was not passed - assume on the map.
      var v = (typeof visible === 'boolean') ? visible : true;
      return new window.Handlebars.SafeString(KK.claim.blockHtml(id, v));
    });
    window.Handlebars.registerHelper('rent_line', function(rent) {
      var v = (typeof rent === 'string' || typeof rent === 'number') ? rent : null;
      var text = KK.rent.format(v);
      if (!text) { return ''; }
      return new window.Handlebars.SafeString(
        '<p class="kk-rent"><span class="kk-rent-amount">' + KK.esc(text) +
        '</span> <span class="kk-rent-period">per month</span></p>');
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

  // ---- Sign-in panel: the map stands down ---------------------------------
  // See the note on body.signin-screen in custom.css. The panel is taller than
  // a phone screen, and stock Shareabouts parks a 325px map above it, so every
  // way of signing in sat below the fold. The CSS hides the map for this one
  // panel; this decides when that is true.
  KK.signinScreen = {
    // Pure: is the sign-in panel the thing on screen right now, and did the
    // visitor ask for it?
    //
    // .signin-page lingers in the DOM for a moment after the panel is
    // dismissed, and content-visible alone is true for every other panel -
    // so both of those are needed.
    //
    // The gate is the third, and it is the one that matters most. On a first
    // visit the panel is opened FOR the visitor, and that screen is built to
    // show the live map blurred behind it (body.signin-gate ... blur(7px))
    // so the first thing anyone sees is still recognisably a map. Taking the
    // map away there leaves a bare form on white, which reads as a broken
    // site or a login wall - the opposite of "no account needed". So during
    // the gate the map stays, panel too tall or not; the fit only applies
    // when someone deliberately tapped Sign in.
    shouldHideMap: function(contentVisible, hasSigninPage, gateActive) {
      return !!(contentVisible && hasSigninPage && !gateActive);
    }
  };

  $(function() {
    var $body = $('body');
    function sync() {
      var want = KK.signinScreen.shouldHideMap(
        $body.hasClass('content-visible'),
        !!document.querySelector('.signin-page'),
        $body.hasClass('signin-gate'));
      // Only write when it actually changes: this runs from an observer that
      // watches body's class, so an unconditional write would retrigger it.
      if (want === $body.hasClass('signin-screen')) { return; }
      $body.toggleClass('signin-screen', want);
    }
    if (window.MutationObserver) {
      // Body's class tells us a panel opened or closed; #content's children
      // tell us one panel was swapped for another without either flag moving.
      new window.MutationObserver(sync).observe(document.body, {
        attributes: true, attributeFilter: ['class']
      });
      var content = document.getElementById('content');
      if (content) {
        new window.MutationObserver(sync).observe(content, { childList: true });
      }
    }
    $(window).on('popstate hashchange', function() { setTimeout(sync, 0); });
    sync();
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

    // The path the visitor actually ARRIVED on, read once while this file is
    // being evaluated - before the app boots and before anything can rewrite
    // the address bar.
    ENTRY_PATH: (window.location && window.location.pathname) || '/',

    // Pure: should the auto-fit stand aside? It must whenever the url already
    // says what to look at - a shared room link, the list, or a /zoom/lat/lng
    // link from a QR code or a message.
    //
    // This is tested against the ENTRY path rather than the live fragment,
    // and that is the whole point. The first-visit sign-in gate navigates to
    // page/signin, so by the time the fit runs a moment later the fragment no
    // longer mentions the coordinates, the guard sees "page/signin", decides
    // the visitor asked for nothing in particular, and re-frames the map on
    // the rooms - throwing away the exact spot the QR code asked for.
    skipFor: function(path) {
      return /^(place\/|list|\d)/.test(String(path || '').replace(/^\/+/, ''));
    },

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
      if (KK.fit.skipFor(KK.fit.ENTRY_PATH)) { return; }

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
    },

    // Pure: which part of the camera frame to decode, and how far to shrink
    // it. Returns null while the video has no dimensions yet.
    //
    // The old loop pushed the WHOLE frame through jsQR four times a second -
    // often 1280x720, sometimes 1920x1080 - which is most of a million pixels
    // of work per pass on a phone that is also running the map. It only ever
    // needed the middle: a QR has to be square-on and reasonably large to
    // decode at all, so the corners of a wide frame never hold the answer.
    //
    // The square returned here is the largest that fits the frame, centred,
    // which is what the white box on screen is drawn around - so whatever the
    // student lines up inside that box is always inside what we read. 400px
    // is far more than a QR needs (roughly 3 pixels per module, and a login
    // card is about 25 modules across).
    frame: function(videoWidth, videoHeight, maxSide) {
      var vw = Math.max(0, videoWidth || 0);
      var vh = Math.max(0, videoHeight || 0);
      var side = Math.min(vw, vh);
      if (!side) { return null; }
      return {
        sx: Math.round((vw - side) / 2),
        sy: Math.round((vh - side) / 2),
        side: side,
        target: Math.min(maxSide || 400, side)
      };
    }
  };

  var scannerStream = null;

  function stopScanner($panel) {
    if (scannerStream) {
      scannerStream.getTracks().forEach(function(track) { track.stop(); });
      scannerStream = null;
    }
    // The overlay is position:fixed while scanning. If it ever outlived its
    // panel it would cover the entire screen with nothing behind it, so the
    // class comes off everywhere rather than only inside the panel we were
    // handed - callers that just want the camera off (a panel closing) need
    // not know which panel it was.
    $('.signin-scanner').addClass('is-hidden').removeClass('is-scanning');
    // Guarded, and it MUST stay guarded. This function is called by the panel
    // watcher above, which runs from a MutationObserver on body's class - and
    // jQuery's removeClass assigns elem.className every time it is called,
    // even when the class was not there and nothing changed:
    //
    //     elem.className = value ? jQuery.trim( cur ) : "";
    //
    // An assignment to className fires that observer whether or not the value
    // changed, so an unguarded write here means observer -> stopScanner ->
    // write -> observer, round forever. It never returns to the event loop, so
    // the page paints once and then ignores every tap: the site looks fine and
    // nothing at all is clickable. That shipped, and it is what took the site
    // down. Read the class before writing it.
    if (document.body.classList.contains('kk-scanning')) {
      document.body.classList.remove('kk-scanning');
    }
    if (!$panel || !$panel.length) { $panel = $('.signin-page'); }
    $panel.find('.signin-scan').removeClass('is-hidden');
  }

  function scanLoop(video, $panel) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    function tick() {
      if (!scannerStream) { return; }
      if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
        var box = KK.qr.frame(video.videoWidth, video.videoHeight);
        if (box) {
          canvas.width = box.target;
          canvas.height = box.target;
          ctx.drawImage(video, box.sx, box.sy, box.side, box.side,
                               0, 0, box.target, box.target);
          var image = ctx.getImageData(0, 0, box.target, box.target);
          var code = window.jsQR(image.data, image.width, image.height);
          var token = code && KK.qr.extractToken(code.data);
          if (token) {
            // A card that reads instantly and then jumps to another page
            // feels like a misfire. One short buzz says "that worked".
            if (navigator.vibrate) { navigator.vibrate(60); }
            stopScanner($panel);
            window.location = '/qr/' + token;
            return;
          }
        }
      }
      setTimeout(tick, 250);
    }
    tick();
  }

  $(document).on('click', '.signin-scan', function() {
    var $panel = $(this).closest('.signin-page');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      KK.alert('Camera is not available here. Scan the card with your phone camera instead, or type your username and password.');
      return;
    }
    var staticUrl = (window.Shareabouts && window.Shareabouts.bootstrapped &&
                     window.Shareabouts.bootstrapped.staticUrl) || '/static/';
    // Both start now, on purpose. The old order downloaded jsQR first (57KB
    // gzipped) and only THEN asked for the camera, so on Butwal mobile data
    // you tapped Scan and watched nothing happen for a second or two. Asking
    // for the camera immediately puts the permission prompt up at once, and
    // the decoder lands while the card is still being lined up.
    var decoderReady = $.getScript(staticUrl + 'libs/jsQR.js');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function(stream) {
        scannerStream = stream;
        var video = $panel.find('.signin-scanner-video')[0];
        video.srcObject = stream;
        video.play();
        $panel.find('.signin-scan').addClass('is-hidden');
        $panel.find('.signin-scanner')
          .removeClass('is-hidden')
          .addClass('is-scanning');
        // Lifts #content over the site header; see body.kk-scanning in the CSS.
        // Guarded for the same reason as the removeClass in stopScanner.
        if (!document.body.classList.contains('kk-scanning')) {
          document.body.classList.add('kk-scanning');
        }
        decoderReady.always(function() {
          // Nothing to decode with: take the camera back down rather than
          // leaving a full-screen black window the Cancel button is the
          // only way out of.
          if (!window.jsQR) {
            stopScanner($panel);
            KK.alert('Could not start the scanner. Please type your username and password.');
            return;
          }
          scanLoop(video, $panel);
        });
      })
      .catch(function() {
        KK.alert('Camera permission was refused. Scan the card with your phone camera instead, or type your username and password.');
      });
  });

  // Escape closes the full-screen camera. Android's Back button is already
  // covered by the panel watcher above, which calls stopScanner when the
  // panel stops being visible.
  $(document).on('keydown', function(e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) { return; }
    if ($('.signin-scanner.is-scanning').length) { stopScanner(null); }
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
        KK.alert('Could not read the photo. Please type your username and password.');
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
          KK.alert('No login card found in that photo. Try a clearer, closer photo of the QR.');
        }
      };
      img.onerror = function() { KK.alert('Could not open that photo.'); };
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
      .fail(function(xhr) {
        $btn.prop('disabled', false).text($btn.data('label') || 'Sign in');
        // The server sends its own wording only when the reason is something
        // the person can act on - currently just "too many wrong passwords,
        // wait a few minutes". Telling them that instead of "wrong password"
        // is the whole point: otherwise they keep trying a password that is
        // not being checked at all.
        var said = xhr && xhr.responseJSON && xhr.responseJSON.error;
        injectSigninError(said || 'Wrong username or password. Please try again.');
      });
  });

  $(function() {
    if (popFlash('login-error')) {
      showSigninProblem('Wrong username or password. Please try again.');
    } else if (popFlash('qr-error')) {
      showSigninProblem('This login card is not valid anymore. Ask KothaKhoj for a new one, or sign in with your username and password.');
    }
  });

  // ---- College markers ----------------------------------------------------
  // Colleges come from the same published Google Sheet the search box uses
  // (columns: name, lat, lng, aliases — edit the sheet, never this file).
  // Each college gets a small dark cap marker and a name chip from zoom 13,
  // so rooms (green/orange pins) stay the loudest thing on the map.
  //
  // Tapping one used to also draw a dashed 300m "campus area" circle. It was
  // a guess - one radius for a two-building school and for a campus that
  // spans a highway - drawn in a colour nothing else on this map uses, and
  // it covered the room pins it was meant to give context to. A tap now just
  // takes you there.
  // Served by our own Django view, which fetches the sheet once per ten
  // minutes and caches it. Fetching Google straight from the browser cost
  // 3,471ms measured from Butwal, in front of every college pin.
  var COLLEGES_CSV_URL = '/colleges.csv';
  var COLLEGE_LABEL_MIN_ZOOM = 13;

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

    colleges.forEach(function(college) {
      // The name lives INSIDE the pin's own icon, not in a Leaflet tooltip.
      //
      // As a tooltip it was a separate layer that Leaflet had to place itself
      // on every frame, and placing one means reading container.offsetWidth -
      // a forced layout - straight after writing a transform to the last one.
      // 141 of those, interleaved, every frame of a pinch: about 92% of the
      // frame went on it, and the pins themselves cost almost nothing because
      // they only ever write. Hiding the labels below zoom 13 did not help
      // either; Leaflet kept placing them while CSS kept them invisible.
      //
      // As a child of the icon the name simply rides the pin's transform. No
      // placing, no layout read, and 141 fewer layers on the map.
      //
      // The 31px and the vertical centring are measured off the tooltip this
      // replaces, so the label lands exactly where it used to.
      var marker = L.marker([college.lat, college.lng], {
        icon: L.divIcon({
          className: 'college-div-icon',
          html: '<span class="college-marker">🎓</span>' +
                '<span class="college-label-text">' + KK.esc(college.name) + '</span>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        }),
        keyboard: false
      });
      // Tap a college: go there. Nothing is drawn on the map.
      marker.on('click', function() {
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
      // Share the one sheet request with the search box in map-view.js, which
      // reads the same published CSV. Each used to fetch it on its own, so
      // every visitor paid for the same slow download twice. The fallback
      // covers a partial deploy: getSheetCsv ships inside dist/preload.js,
      // which is rsynced separately from this file.
      var S = window.Shareabouts;
      var fetchSheet = (S && S.Util && S.Util.getSheetCsv) ?
        S.Util.getSheetCsv(COLLEGES_CSV_URL) :
        $.get(COLLEGES_CSV_URL);

      fetchSheet.done(function(text) {
        var colleges = KK.colleges.parseCsv(text);
        if (colleges.length) { addCollegeLayer(map, colleges); }
      })
      .fail(function() {
        // Nothing from Google and nothing cached. Colleges are the only
        // thing on the map until rooms arrive, so say so rather than leaving
        // a blank map that looks broken.
        if (window.console && window.console.warn) {
          window.console.warn('College list unavailable; map is showing rooms only.');
        }
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
    },

    // Pure: may "hide until free" be offered, and what should be stored.
    //
    // Offered only in month mode with a month actually chosen. That is the
    // whole guard against the one way this feature can hurt somebody: with
    // "Not sure yet" there is no date, so a ticked box would take the room
    // off the map with nothing that could ever bring it back. The poster
    // would conclude the site lost their room and post it again, and we
    // would have a duplicate and an angry landlord.
    //
    // `value` is '' whenever the box is not offered, so switching from
    // "Pick a month" to "Not sure yet" CLEARS a tick that was already made
    // rather than leaving it stored under an answer it does not fit.
    hideDecision: function(kind, hasMonth, ticked) {
      var offered = (kind === 'date' && !!hasMonth);
      return { offered: offered, value: (offered && !!ticked) ? 'yes' : '' };
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

  // Draw and store the "hide until free" box. Called from every branch of
  // refreshFreePicker, so there is no path through the picker that leaves a
  // stale tick behind.
  function writeHideUntilFree($picker, kind, label) {
    var $box = $picker.find('.free-hide-until');
    var $check = $picker.find('.free-hide-check');
    var decision = KK.freeDate.hideDecision(kind, !!label, $check.prop('checked'));

    $box.toggleClass('is-hidden', !decision.offered);
    if (!decision.offered) { $check.prop('checked', false); }

    $picker.find('.free-hide-why').text(
      decision.offered && label ?
        'Nobody will see it until ' + label + '. Tick this if you still live here.' :
        '');
    $picker.find('input[name="hide_until_free"]').val(decision.value);
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
      writeHideUntilFree($picker, 'now', '');
      $preview.html('Students will see: <span class="free-badge free-badge-now">Available now</span>');
      return;
    }

    if (kind === 'ask') {
      $months.addClass('is-hidden');
      $date.addClass('is-hidden');
      writeFree($picker, KK.freeDate.compute('ask'));
      writeHideUntilFree($picker, 'ask', '');
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
      // Month mode with no month is stored as "ask", so the box must not be
      // offered here either - there is still no date to come back on.
      writeHideUntilFree($picker, 'date', '');
      $preview.html('Students will see: <span class="free-badge free-badge-ask">Someone lives here now — call and ask</span>');
      return;
    }

    var chosen = months[Number($active.data('i'))];
    var result = KK.freeDate.compute(chosen);
    $date.removeClass('is-hidden').text('Free from the start of ' + result.label + '.');
    $preview.html('Students will see: <span class="free-badge free-badge-later">Free from ' +
      KK.esc(result.label) + '</span>');
    writeFree($picker, result);
    writeHideUntilFree($picker, 'date', result.label);
  }

  // ---- Claim button -------------------------------------------------------
  // Delegated, because the detail panel is re-rendered by Marionette on every
  // navigation and a handler bound to the button itself would die with it.
  //
  // PlaceListItemView renders rows with template '#place-detail' - the SAME
  // template as the panel - so every row in the room list carries a full copy
  // of this block, claim button included. Claiming from a list row would hide
  // a room from a screen where the student never opened it, and would put
  // five of these buttons on one screen. This guard is the only thing that
  // stops it: do NOT assume a CSS rule is also hiding them, because that
  // rule lives in custom.css and may not be deployed alongside this file.
  //
  // Returns null for anything we refuse to act on. The .length check is not
  // decoration: .closest() returns an EMPTY jQuery object when it matches
  // nothing, and an empty jQuery object is truthy - so a caller writing
  // `if (!$block) return;` would sail straight past it and then operate on
  // a collection of zero elements, silently doing nothing.
  function claimBlockOf(el) {
    var $block = $(el).closest('.kk-claim');
    if (!$block.length) { return null; }
    if ($block.closest('#list-container').length) { return null; }
    return $block;
  }

  $(document).on('click', '.kk-claim-start', function() {
    var $block = claimBlockOf(this);
    if (!$block) { return; }
    $block.addClass('kk-claim-open').html(KK.claim.confirmHtml());
    $block.find('.kk-claim-phone').trigger('focus');
  });

  $(document).on('click', '.kk-claim-cancel', function() {
    var $block = claimBlockOf(this);
    if (!$block) { return; }
    $block.removeClass('kk-claim-open')
          .html('<button type="button" class="btn btn-block kk-claim-start">' +
                KK.esc(KK.claim.TEXT.start) + '</button>');
  });

  $(document).on('click', '.kk-claim-go', function() {
    var $block = claimBlockOf(this);
    if (!$block) { return; }
    var id = $block.data('place-id'),
        phone = String($block.find('.kk-claim-phone').val() || '').trim(),
        $go = $(this);

    // Disable BEFORE the request, not after it comes back. On a slow phone
    // the gap is long enough to tap twice, and the second tap would be
    // refused as "already on hold" and read as a failure.
    if ($go.prop('disabled')) { return; }
    $go.prop('disabled', true).text('...');

    KK.claim.post(id, phone).then(function(result) {
      $block.removeClass('kk-claim-open')
            .addClass(result.granted ? 'kk-claim-done' : 'kk-claim-refused')
            .html('<p class="kk-claim-result">' + KK.esc(result.message) + '</p>');

      // The room is off the map now, so the map behind this panel is stale.
      // Reloading is blunt but honest: it is the only way the marker goes.
      if (result.granted && window.app && window.app.collection) {
        setTimeout(function() { window.location.reload(); }, 2500);
      }
    });
  });

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

  // 'invalid' does NOT bubble, so jQuery delegation cannot see it - this has
  // to be a capturing listener on the document. Getting that wrong fails
  // silently: the handler never runs and the browser's default text shows,
  // which looks exactly like the feature working badly rather than not at all.
  (function() {
    // Guarded because this file is also loaded by run-kk-tests.js, which
    // stubs document as a plain object with no addEventListener. Without the
    // guard the whole file throws at load and every test dies - which is how
    // this was found.
    if (!document || typeof document.addEventListener !== 'function') { return; }

    function applyMessage(el) {
      if (!el || !el.setCustomValidity) { return; }
      var msg = KK.validationMessage(el.name, el.validity);
      el.setCustomValidity(msg);
    }
    document.addEventListener('invalid', function(evt) {
      applyMessage(evt.target);
    }, true);
    // Clear as soon as they start fixing it. Without this the custom message
    // STICKS: setCustomValidity makes the field permanently invalid until it
    // is set back to '', so a corrected number would still refuse to submit.
    function clear(evt) {
      var el = evt.target;
      if (el && el.setCustomValidity) { el.setCustomValidity(''); }
    }
    document.addEventListener('input', clear, true);
    document.addEventListener('change', clear, true);
  })();

  $(document).on('change', '.free-picker .free-hide-check', function() {
    refreshFreePicker($(this).closest('.free-picker'));
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
