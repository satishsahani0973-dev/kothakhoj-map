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

    // "9812345678" / "09812345678" / "+977 981-2345678" -> a wa.me link;
    // null when there aren't enough digits to be a phone number.
    waLink: function(contact) {
      var digits = String(contact == null ? '' : contact).replace(/[^0-9]/g, '');
      digits = digits.replace(/^0+/, '').replace(/^977/, '');
      if (digits.length < 9) { return null; }
      return 'https://wa.me/977' + digits;
    }
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
    $('.use-location-btn').prop('disabled', false).text('find me again');
  }

  $(document).on('click', '.use-location-btn', function() {
    var $btn = $(this);
    var map = currentMap();
    if (!map) { return; }
    $btn.prop('disabled', true).text('finding you…');
    KK.geo.locate(map, {
      onFirst: function(fix) { map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17)); },
      onDone: function(fix) { applyFixToForm(fix, false); },
      onError: function(message) {
        setLocationStatus('weak', message);
        $btn.prop('disabled', false).text('use my location');
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
    // never exposes private-* data publicly) and a public device_bound
    // marker so the detail view knows the strict rule applies.
    var S = window.Shareabouts;
    if (S && S.PlaceFormView) {
      var kkOrigGetAttrs = S.PlaceFormView.prototype.getAttrs;
      S.PlaceFormView.prototype.getAttrs = function() {
        var attrs = kkOrigGetAttrs.apply(this, arguments);
        attrs['private-device_token'] = KK.deviceToken;
        attrs['device_bound'] = true;
        return attrs;
      };
    }
  }

})(jQuery);
