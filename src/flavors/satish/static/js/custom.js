/*globals jQuery */
// KothaKhoj flavor behaviors, loaded after the app scripts on every page.
// Keep all flavor JS here: <script> tags inside jstemplates break the
// inline {% handlebarsjs %} embed in base.html.
(function($) {

  // Namespace for flavor logic; pure functions live here so Jasmine can
  // exercise them without a DOM or storage.
  var KK = window.KothaKhoj = window.KothaKhoj || {};

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
    }
  };

  // ---- Availability badge -------------------------------------------------
  // Pure decision used by the detail page badge (and tests): a place is
  // available unless it carries a future free_ts. Legacy places have no
  // free_ts at all and must read as available.
  KK.availability = function(free_ts, now) {
    var ts = Number(free_ts);
    now = now || Date.now();
    if (!ts || isNaN(ts) || ts <= now) { return { state: 'now', label: '' }; }
    return {
      state: 'later',
      label: new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    };
  };

  if (window.Handlebars) {
    window.Handlebars.registerHelper('free_badge', function(free_ts) {
      var a = KK.availability(free_ts);
      var html = a.state === 'now' ?
        '<span class="free-badge free-badge-now">Available now</span>' :
        '<span class="free-badge free-badge-later">Not available — free from ' + a.label + '</span>';
      return new window.Handlebars.SafeString(html);
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

  // Closing the gate panel in any way counts as "continue browsing":
  // the panel's Continue button and the pink ✕ both carry .close-btn.
  $(document).on('click', 'body.signin-gate .close-btn', function() {
    KK.gate.rememberChoice();
    $('body').removeClass('signin-gate');
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
    // Pure: CSV text -> [{name, lat, lng}], dropping rows without a name
    // or with unusable coordinates.
    parseCsv: function(text) {
      var lines = String(text || '').trim().split('\n');
      if (lines.length < 2) { return []; }
      var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
      var out = [];
      for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(',');
        var row = {};
        headers.forEach(function(h, idx) { row[h] = (cols[idx] || '').trim(); });
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

  // ---- "When will this room be free?" picker ------------------------------
  // Three choices (Now / Month / Year), 1-4 chips or a typed number, and a
  // live computed date. The form stores free_from (YYYY-MM-DD, for humans
  // and the detail page) and free_ts (epoch ms, for the map color rules).
  // "Now" stores empty strings, which the color rules read as available.
  KK.freeDate = {
    MAX: { month: 11, year: 10 },

    clamp: function(kind, n) {
      n = parseInt(n, 10);
      if (isNaN(n) || n < 1) { return 1; }
      return Math.min(n, KK.freeDate.MAX[kind] || 1);
    },

    // Pure: compute the free-from date for a choice. `from` is injectable
    // so tests can pin the current date.
    compute: function(kind, n, from) {
      if (kind !== 'month' && kind !== 'year') {
        return { freeFrom: '', freeTs: '', label: '', n: 0 };
      }
      n = KK.freeDate.clamp(kind, n);
      var d = new Date((from || new Date()).getTime());
      if (kind === 'month') { d.setMonth(d.getMonth() + n); }
      else { d.setFullYear(d.getFullYear() + n); }
      var pad = function(x) { return (x < 10 ? '0' : '') + x; };
      return {
        freeFrom: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        freeTs: String(d.getTime()),
        label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        n: n
      };
    }
  };

  function refreshFreePicker($picker) {
    var kind = $picker.find('.free-kind.is-active').data('kind') || 'now';
    var $count = $picker.find('.free-picker-count');
    var $date = $picker.find('.free-picker-date');
    var $preview = $picker.find('.free-picker-preview');
    var $custom = $picker.find('.free-count-custom');

    if (kind === 'now') {
      $count.addClass('is-hidden');
      $date.addClass('is-hidden');
      $picker.find('input[name="free_from"]').val('');
      $picker.find('input[name="free_ts"]').val('');
      $preview.html('Students will see: <span class="free-badge free-badge-now">Available now</span>');
      return;
    }

    var unit = kind === 'month' ? 'month' : 'year';
    var typed = $.trim($custom.val());
    var n = typed !== '' ? typed : ($picker.find('.free-count.is-active').data('n') || 1);
    var result = KK.freeDate.compute(kind, n);
    var units = result.n === 1 ? unit : unit + 's';

    $count.removeClass('is-hidden');
    $count.find('.free-picker-count-label').text('How many ' + unit + 's? (1–' + KK.freeDate.MAX[kind] + ')');
    $custom.attr('max', KK.freeDate.MAX[kind]);
    $date.removeClass('is-hidden').text('Free on ' + result.label + ' (today + ' + result.n + ' ' + units + ')');
    $preview.html('Students will see: <span class="free-badge free-badge-later">Free from ' + result.label + '</span>');
    $picker.find('input[name="free_from"]').val(result.freeFrom);
    $picker.find('input[name="free_ts"]').val(result.freeTs);
  }

  $(document).on('click', '.free-picker .free-kind', function() {
    var $picker = $(this).closest('.free-picker');
    $picker.find('.free-kind').removeClass('is-active');
    $(this).addClass('is-active');
    // Reset the number to a fresh default when switching unit.
    $picker.find('.free-count').removeClass('is-active').first().addClass('is-active');
    $picker.find('.free-count-custom').val('');
    refreshFreePicker($picker);
  });

  $(document).on('click', '.free-picker .free-count', function() {
    var $picker = $(this).closest('.free-picker');
    $picker.find('.free-count').removeClass('is-active');
    $(this).addClass('is-active');
    $picker.find('.free-count-custom').val('');
    refreshFreePicker($picker);
  });

  $(document).on('input change', '.free-picker .free-count-custom', function() {
    var $picker = $(this).closest('.free-picker');
    if ($.trim($(this).val()) !== '') {
      $picker.find('.free-count').removeClass('is-active');
    }
    refreshFreePicker($picker);
  });

  // Snap an out-of-range typed number back into range when leaving the field.
  $(document).on('blur', '.free-picker .free-count-custom', function() {
    var $picker = $(this).closest('.free-picker');
    var kind = $picker.find('.free-kind.is-active').data('kind');
    var raw = $.trim($(this).val());
    if (raw !== '' && (kind === 'month' || kind === 'year')) {
      $(this).val(KK.freeDate.clamp(kind, raw));
      refreshFreePicker($picker);
    }
  });

  // The sign-in panel form posts to Django, which needs the CSRF token the
  // map page set as a cookie. Fill it just before the POST leaves.
  $(document).on('submit', '.signin-form', function() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) { $(this).find('input[name="csrfmiddlewaretoken"]').val(m[1]); }
  });

})(jQuery);
