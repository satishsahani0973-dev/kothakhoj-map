/*globals L Backbone _ */

var Shareabouts = Shareabouts || {};

(function(S, $, console){
  S.MapView = Backbone.View.extend({
    events: {
      'click .locate-me': 'onClickGeolocate'
    },
    initialize: function() {
      var self = this,
          i, layerModel,
          logUserZoom = function() {
            S.Util.log('USER', 'map', 'zoom', self.map.getBounds().toBBoxString(), self.map.getZoom());
          },
          logUserPan = function(evt) {
            S.Util.log('USER', 'map', 'drag', self.map.getBounds().toBBoxString(), self.map.getZoom());
          };

      // Init the map
      self.map = L.map(self.el, self.options.mapConfig.options);
      self.placeLayers = L.layerGroup();

      // Add layers defined in the config file
      function addMapLayer(config) {
        var layer;

        // type is required by Argo for fetching data, so it's a pretty good
        // Argo indicator. Argo is this by the way: https://github.com/openplans/argo/
        if (config.type && config.type === 'mapbox') {
          if (!config.accessToken) { config.accessToken = S.bootstrapped.mapboxToken; }
          try {
            layer = L.mapboxGL(config)
            layer.addTo(self.map);
          } catch (error) {
            // If creation of the GL layer fails for any reason, we may have to
            // clean up.
            if (layer) {
              // The _glMap may never have been successfully set on the layer,
              // so we need to patch it.
              layer._glMap = {remove: function () {}};
              layer.removeFrom(self.map);
            }

            // Many users may fail because of lack of WebGL support. For that
            // case, provide a fallback set of tiles.
            if (config.fallback) {
              layer = addMapLayer(config.fallback);
            }
            else {
              throw error;
            }
          }
        } else if (config.type) {
          layer = L.argo(config.url, config).addTo(self.map);
        } else {
          // Assume a tile layer
          layer = L.tileLayer(config.url, config).addTo(self.map);
        }
        return layer;
      }

      _.each(self.options.mapConfig.layers, addMapLayer);

      // Remove default prefix
      self.map.attributionControl.setPrefix('');

      // Init geolocation
      if (self.options.mapConfig.geolocation_enabled) {
        self.initGeolocation();
      }

      if (self.options.mapConfig.geocoding_enabled) {
        // self.initGeocoding(); // merged into initLocalSearch above
      }

      self.map.addLayer(self.placeLayers);
      self.initLocalSearch();

      // Init the layer view cache
      this.layerViews = {};

      self.map.on('dragend', logUserPan);
      $(self.map.zoomControl._zoomInButton).click(logUserZoom);
      $(self.map.zoomControl._zoomOutButton).click(logUserZoom);

      self.map.on('zoomend', function(evt) {
        S.Util.log('APP', 'zoom', self.map.getZoom());
      });

      self.map.on('moveend', function(evt) {
        S.Util.log('APP', 'center-lat', self.map.getCenter().lat);
        S.Util.log('APP', 'center-lng', self.map.getCenter().lng);

        $(S).trigger('mapmoveend', [evt]);
      });

      self.map.on('dragend', function(evt) {
        $(S).trigger('mapdragend', [evt]);
      });

      // Bind data events
      self.collection.on('reset', self.render, self);
      self.collection.on('add', self.addLayerView, self);
      self.collection.on('remove', self.removeLayerView, self);

      // When the user saves a new place, immediately repaint that marker gold
      // (and refresh the "Yours" legend) without waiting for a map move.
      $(S).on('myplacesaved', function(evt, model) {
        var lv = self.layerViews[model.cid];
        if (lv) { lv.updateLayer(); }
        self.updateMyPlacesLegend();
      });
    },
    reverseGeocodeMapCenter: _.debounce(function() {
      var center = this.map.getCenter();
      var geocodingEngine = this.options.mapConfig.geocoding_engine || 'MapQuest';

      S.Util[geocodingEngine].reverseGeocode(center, {
        success: function(data) {
          var locationData = S.Util[geocodingEngine].getLocation(data);
          // S.Util.console.log('Reverse geocoded center: ', data);
          $(S).trigger('reversegeocode', [locationData]);
        }
      });
    }, 1000),
    render: function() {
      var self = this;

      // Clear any existing stuff on the map, and free any views in
      // the list of layer views.
      this.placeLayers.clearLayers();
      this.layerViews = {};

      this.collection.each(function(model, i) {
        self.addLayerView(model);
      });
    },
    initGeolocation: function() {
      var self = this;

      var resetLocateButton = function() {
        self.$('.locate-me').removeClass('locating').text('My Location');
      };

      var onLocationError = function(evt) {
        var message;
        resetLocateButton();
        switch (evt.code) {
          // Unknown
          case 0:
            message = 'An unknown error occured while locating your position. Please try again.';
            break;
          // Permission Denied
          case 1:
            message = 'Geolocation is disabled for this page. Please adjust your browser settings.';
            break;
          // Position Unavailable
          case 2:
            message = 'Your location could not be determined. Please try again.';
            break;
          // Timeout
          case 3:
            message = 'It took too long to determine your location. Please try again.';
            break;
        }
        alert(message);
      };

      var onLocationFound = function(evt) {
        var msg;
        resetLocateButton();
        if(!self.map.options.maxBounds ||self.map.options.maxBounds.contains(evt.latlng)) {
          self.map.setView(evt.latlng, 18);
          // Let the app know the user located themselves, so that if the
          // add-place form is open, the pin can be set to this spot right away
          // (no need to drag the map first).
          $(S).trigger('userlocated', [evt.latlng]);
        } else {
          msg = 'It looks like you\'re not in a place where we\'re collecting ' +
            'data. I\'m going to leave the map where it is, okay?';
          alert(msg);
        }
      };

      // Add the geolocation control link
      this.$('.leaflet-top.leaflet-right').append(
        '<div class="leaflet-control leaflet-bar locate-control">' +
          '<a href="#" class="locate-me" role="button" title="Center on my location" aria-label="Center on my location">My Location</a>' +
        '</div>'
      );

      // Bind event handling
      this.map.on('locationerror', onLocationError);
      this.map.on('locationfound', onLocationFound);

      // Go to the current location if specified
      if (this.options.mapConfig.geolocation_onload) {
        this.geolocate();
      }
    },
    initLocalSearch: function() {
      var self = this;
      var SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTgmcyTZFZwmOXuMdam-su8Zq-GIs42qhJXS0G-jmZ6Fi9MUfQseKakGXKiH2ATNvrn2ESTQE1aGRvj/pub?gid=0&single=true&output=csv";

      function geocodeMapbox(query, callback) {
        var params = {
          access_token: S.bootstrapped.mapboxToken,
          country: 'np',
          proximity: [
            self.options.mapConfig.options.center.lng,
            self.options.mapConfig.options.center.lat
          ].join(','),
          bbox: '83.35,27.45,83.55,27.75',
          limit: 5
        };
        $.getJSON('https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(query) + '.json', params)
          .done(function(data) {
            var results = (data.features || []).map(function(f) {
              var center = L.latLng(f.center[1], f.center[0]);
              var bounds = f.bbox ?
                L.latLngBounds(L.latLng(f.bbox[1], f.bbox[0]), L.latLng(f.bbox[3], f.bbox[2])) :
                L.latLngBounds(center, center);
              return { name: f.place_name, center: center, bbox: bounds };
            });
            callback(results);
          })
          .fail(function() {
            console.log('Mapbox geocode request failed for query:', query);
            callback([]);
          });
      }

      var places = [];

      function parseCSV(text) {
        var lines = text.trim().split('\n');
        var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
        var rows = [];
        for (var i = 1; i < lines.length; i++) {
          var cols = lines[i].split(',');
          var row = {};
          headers.forEach(function(h, idx) {
            row[h] = cols[idx] ? cols[idx].trim() : '';
          });
          rows.push(row);
        }
        return rows;
      }

      var loadFuse = function() {
        var searchEntries = [];
        places.forEach(function(p) {
          searchEntries.push(p);
          if (p.aliases) {
            p.aliases.split(',').forEach(function(alias) {
              searchEntries.push({ name: alias.trim(), displayName: p.name, lat: p.lat, lng: p.lng });
            });
          } else {
            p.displayName = p.name;
          }
        });
        self.localFuse = new Fuse(searchEntries, { keys: ['name'], threshold: 0.4 });
      };

      var setupFuseAndData = function() {
        $.get(SHEET_CSV_URL, function(csvText) {
          parseCSV(csvText).forEach(function(row) {
            if (row.name && row.lat && row.lng) {
              places.push({
                name: row.name,
                lat: parseFloat(row.lat),
                lng: parseFloat(row.lng),
                aliases: row.aliases || ''
              });
            }
          });
          if (typeof Fuse === 'undefined') {
            var script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/fuse.js/6.6.2/fuse.min.js';
            script.onload = loadFuse;
            document.head.appendChild(script);
          } else {
            loadFuse();
          }
        });
      };

      setupFuseAndData();

      var $box = $(
        '<div class="merged-search-box" style="position:absolute; z-index:1200; top:70px; left:50%; transform:translateX(-50%); background:white; border-radius:4px; box-shadow:0 1px 5px rgba(0,0,0,0.4);">' +
          '<input type="text" placeholder="Search places or addresses..." style="width:320px; padding:10px; border:none; outline:none; border-radius:4px; font-size:15px;">' +
          '<div class="merged-search-results" style="background:white;"></div>' +
        '</div>'
      );
      $(self.el).append($box);

      var $input = $box.find('input');
      var $results = $box.find('.merged-search-results');
      var geocodeTimer = null;

      function renderResults(localMatches, mapboxMatches) {
        $results.empty();
        var seen = {};

        localMatches.forEach(function(m) {
          var place = m.item;
          var label = place.displayName || place.name;
          if (seen[label]) { return; }
          seen[label] = true;
          var $item = $('<div style="padding:8px; cursor:pointer; border-top:1px solid #eee;">\uD83D\uDCCD ' + label + '</div>');
          $item.on('click', function() {
            self.map.setView([place.lat, place.lng], 17);
            $input.val(label);
            $results.empty();
          });
          $results.append($item);
        });

        mapboxMatches.forEach(function(result) {
          var $item = $('<div style="padding:8px; cursor:pointer; border-top:1px solid #eee;">\uD83C\uDF0D ' + result.name + '</div>');
          $item.on('click', function() {
            var zoom = self.map.getBoundsZoom(result.bbox);
            self.map.setView(result.center, zoom);
            $input.val(result.name);
            $results.empty();
          });
          $results.append($item);
        });
      }

      $input.on('input', function() {
        var query = $(this).val();
        $results.empty();
        if (!query) { return; }

        var localMatches = self.localFuse ? self.localFuse.search(query).slice(0, 5) : [];
        renderResults(localMatches, []);

        clearTimeout(geocodeTimer);
        geocodeTimer = setTimeout(function() {
          geocodeMapbox(query, function(mapboxResults) {
            renderResults(localMatches, mapboxResults);
          });
        }, 400);
      });
    },

    initGeocoding: function() {
      var geocoder;
      var control;
      var options = {
          collapsed: false,
          position: 'topright',
          defaultMarkGeocode: false,
          geocoder: geocoder
        };

      switch (this.options.mapConfig.geocoding_engine) {
        case 'Mapbox':
          options.geocoder = L.Control.Geocoder.mapbox(S.bootstrapped.mapboxToken, {
            geocodingQueryParams: {            
              proximity: [
                this.options.mapConfig.options.center.lng,
                this.options.mapConfig.options.center.lat
              ].join(','),
              country: 'np',
              bbox: '83.35,27.45,83.55,27.75'
            }
          });
          break;

        default:
          options.geocoder = L.Control.Geocoder.mapQuest(S.bootstrapped.mapQuestKey);
          break;
      }

      if (this.options.mapConfig.geocode_field_label) {
        options.placeholder = this.options.mapConfig.geocode_field_label
      }

      control = L.Control.geocoder(options)
        .on('markgeocode', function(evt) {
          result = evt.geocode || evt;
          const zoom = this._map.getBoundsZoom(result.bbox);
          const center = result.center;
          this._map.setView(center, zoom);
          $(S).trigger('geocode', [evt]);
        })
        .addTo(this.map);

      // Move the control to the center
      $('<div class="leaflet-top leaflet-center"/>')
        .insertAfter($('.leaflet-top.leaflet-left'))
        .append($(control._container))

      Shareabouts.geocoderControl = control;
    },
    onClickGeolocate: function(evt) {
      evt.preventDefault();
      S.Util.log('USER', 'map', 'geolocate', this.map.getBounds().toBBoxString(), this.map.getZoom());
      // Immediate feedback while GPS is working (it can take several seconds).
      this.$('.locate-me').addClass('locating').text('Locating…');
      this.geolocate();
    },
    geolocate: function() {
      // Prefer the flavor's location engine (blue dot + accuracy circle +
      // few-second refine) when it is loaded; fall back to plain Leaflet.
      var self = this;
      var geo = window.KothaKhoj && window.KothaKhoj.geo;
      if (geo) {
        geo.locate(this.map, {
          onFirst: function(fix) {
            self.map.setView([fix.lat, fix.lng], Math.max(self.map.getZoom(), 16));
          },
          onDone: function(fix) {
            self.$('.locate-me').removeClass('locating').text('My Location');
            if (fix) {
              $(S).trigger('userlocated', [L.latLng(fix.lat, fix.lng)]);
            }
          },
          onError: function(message) {
            self.$('.locate-me').removeClass('locating').text('My Location');
            alert(message);
          }
        });
        return;
      }
      this.map.locate({ enableHighAccuracy: true, maximumAge: 0 });
    },
    startDirections: function(destLatLng, placeModel) {
      var self = this;
      this.stopDirections();

      if (!navigator.geolocation) {
        alert('Your browser does not support location. Directions are not available.');
        return;
      }

      this.routingDest = destLatLng;
      var KKR = window.KothaKhoj && window.KothaKhoj.route;
      var contact = placeModel && placeModel.get ? placeModel.get('contact_number') : null;
      var waHref = (KKR && contact) ? KKR.waLink(contact) : null;

      var state = 'locating';
      var profile = 'walking';
      var lastRouted = null;
      var lastSummary = null;
      var started = false;
      var arrived = false;
      var lastRouteTime = 0;
      var MODES = [
        { key: 'walking', label: 'Walk' },
        { key: 'cycling', label: 'Cycle' },
        { key: 'driving', label: 'Drive' }
      ];

      // One bottom card carries the whole flow:
      // locating -> route preview (with Start) -> live navigation -> arrived.
      var $card = this.$routeCard = $('<div class="kk-route-card"></div>').css({
        position: 'absolute', left: '10px', right: '10px', bottom: '14px',
        maxWidth: '380px', margin: '0 auto', background: '#fff', color: '#222',
        borderRadius: '14px', boxShadow: '0 2px 14px rgba(0,0,0,0.35)',
        padding: '12px 14px', zIndex: 1000, fontSize: '14px'
      });
      this.$el.append($card);
      $card.on('mousedown dblclick touchstart pointerdown wheel', function(evt) {
        evt.stopPropagation();
      });

      var render = function() {
        if (!self.$routeCard) { return; }
        var parts = (lastSummary && KKR) ?
          KKR.fmtSummary(lastSummary.totalDistance, lastSummary.totalTime).split(' · ') :
          null;
        var big = parts ? parts[1] : '&hellip;';
        var small = parts ? parts[0] : '';
        var html = '';
        if (state === 'locating') {
          html =
            '<div style="display:flex; align-items:center; justify-content:space-between;">' +
              '<span>Locating&hellip;</span>' +
              '<a href="#" class="kk-rc-cancel" style="color:#c0392b; font-weight:bold;' +
                ' text-decoration:none; padding:0 4px;">&#10005;</a>' +
            '</div>';
        } else if (state === 'preview') {
          var chips = '';
          $.each(MODES, function(i, m) {
            var on = m.key === profile;
            chips += '<a href="#" class="kk-rc-mode" data-profile="' + m.key + '"' +
              ' style="text-decoration:none; border-radius:14px; padding:4px 12px; font-size:12px;' +
              ' border:1px solid ' + (on ? '#007fbf' : '#ddd') + ';' +
              ' background:' + (on ? '#007fbf' : '#fff') + ';' +
              ' color:' + (on ? '#fff' : '#444') + ';">' + m.label + '</a>';
          });
          html =
            '<div style="font-size:22px; font-weight:bold;">' + big +
              ' <span style="font-size:13px; color:#888; font-weight:normal;">' + small + '</span></div>' +
            '<div style="display:flex; gap:7px; margin:9px 0 11px;">' + chips + '</div>' +
            '<div style="display:flex; gap:8px;">' +
              '<a href="#" class="kk-rc-start" style="flex:2.2; background:#2e9e44; color:#fff;' +
                ' border-radius:9px; text-align:center; padding:9px 0; font-weight:bold;' +
                ' text-decoration:none;">Start</a>' +
              '<a href="#" class="kk-rc-cancel" style="flex:1; border:1px solid #ddd; color:#666;' +
                ' border-radius:9px; text-align:center; padding:9px 0; text-decoration:none;">Cancel</a>' +
            '</div>';
        } else if (state === 'nav') {
          html =
            '<div style="font-size:22px; font-weight:bold;">' + big +
              ' <span style="font-size:13px; color:#888; font-weight:normal;">' + small + ' left</span></div>' +
            '<div style="font-size:12px; color:#2e7d32; margin:4px 0 9px;">You are on the way</div>' +
            '<a href="#" class="kk-rc-stop" style="display:block; border:1px solid #e5b8b2; color:#c0392b;' +
              ' border-radius:9px; text-align:center; padding:8px 0; font-weight:bold;' +
              ' text-decoration:none;">Stop</a>';
        } else if (state === 'arrived') {
          html =
            '<div style="font-size:18px; font-weight:bold; color:#1d7a34;">&#10003; You have arrived!</div>' +
            '<div style="font-size:12px; color:#37623f; margin:5px 0 10px;">Like the room? Talk to the owner.</div>' +
            '<div style="display:flex; gap:8px;">' +
              (waHref ?
                '<a href="' + waHref + '" target="_blank" rel="noopener" style="flex:2; background:#25a05a;' +
                  ' color:#fff; border-radius:9px; text-align:center; padding:9px 0; font-weight:bold;' +
                  ' text-decoration:none;">WhatsApp the owner</a>' : '') +
              '<a href="#" class="kk-rc-close" style="flex:1; border:1px solid #ddd; color:#666;' +
                ' border-radius:9px; text-align:center; padding:9px 0; text-decoration:none;">Close</a>' +
            '</div>';
        }
        $card.css('background', state === 'arrived' ? '#e9f6ec' : '#fff');
        $card.html(html);
      };

      $card.on('click', '.kk-rc-cancel, .kk-rc-stop, .kk-rc-close', function(evt) {
        evt.preventDefault();
        self.stopDirections();
      });
      $card.on('click', '.kk-rc-start', function(evt) {
        evt.preventDefault();
        if (started || state !== 'preview') { return; }
        started = true;
        state = 'nav';
        render();
        // On phones the header collapses while navigating (flavor CSS keys
        // off this class) so the map gets almost the whole screen.
        $('body').addClass('kk-routing');
        self.map.invalidateSize();
        if (lastRouted) {
          self.map.setView(lastRouted, Math.max(self.map.getZoom(), 16));
        }
        beginWatch();
      });
      $card.on('click', '.kk-rc-mode', function(evt) {
        evt.preventDefault();
        var p = $(this).data('profile');
        if (p === profile || state !== 'preview') { return; }
        profile = p;
        try { window.localStorage.setItem('kk-route-mode', p); } catch (e) {}
        lastSummary = null;
        if (self.routingControl) {
          self.map.removeControl(self.routingControl);
          self.routingControl = null;
        }
        render();
        makeRoute(p, true);
      });

      // Build the route for a given travel profile. Walking gives the
      // shortest door-to-door path for nearby places, but Mapbox walking
      // has a maximum distance; if it fails, fall back to driving once.
      // Manual mode taps land here too (isFallback: no second fallback).
      var makeRoute = function(prof, isFallback) {
        var fitOnce = false;
        self.routingControl = L.Routing.control({
          waypoints: [lastRouted, destLatLng],
          router: L.Routing.mapbox(S.bootstrapped.mapboxToken, { profile: 'mapbox/' + prof }),
          fitSelectedRoutes: false,
          addWaypoints: false,
          draggableWaypoints: false,
          show: false,
          collapsible: true,
          lineOptions: {
            styles: [
              { color: '#ffffff', opacity: 0.9, weight: 9 },
              { color: '#007fbf', opacity: 1, weight: 5 }
            ]
          },
          // "You" is the familiar blue dot; the room already has its own
          // pin on the map, so no second marker at the destination.
          createMarker: function(i, wp) {
            if (i === 0) {
              return L.circleMarker(wp.latLng, {
                radius: 8, color: '#fff', weight: 2,
                fillColor: '#007fbf', fillOpacity: 1
              });
            }
            return null;
          }
        }).addTo(self.map);

        // Preview: zoom the map out so the student sees the WHOLE trip -
        // where they are, where the room is, and the road between - with
        // room for the bottom card. After Start, never re-zoom on re-routes.
        self.routingControl.on('routesfound', function(e) {
          var route = e.routes && e.routes[0];
          if (route && !fitOnce && !started) {
            fitOnce = true;
            try {
              self.map.fitBounds(L.latLngBounds(route.coordinates), {
                paddingTopLeft: [30, 60],
                paddingBottomRight: [30, 190]
              });
            } catch (err) {
              self.map.fitBounds(L.latLngBounds([lastRouted, destLatLng]).pad(0.25));
            }
          }
          if (route && route.summary) {
            lastSummary = route.summary;
            render();
          }
        });

        self.routingControl.on('routingerror', function() {
          if (!isFallback && prof === 'walking') {
            if (self.routingControl) {
              self.map.removeControl(self.routingControl);
              self.routingControl = null;
            }
            profile = 'driving';
            render();
            makeRoute('driving', true);
          } else {
            self.stopDirections();
            alert('Could not find a route to this place.');
          }
        });
      };

      // Live navigation: follow the GPS, re-route as the user moves, notice
      // the arrival. Runs only after the student taps Start.
      var beginWatch = function() {
        lastRouteTime = Date.now();
        // Keep the phone screen awake while walking (needs HTTPS; silently
        // unavailable elsewhere).
        if (navigator.wakeLock && navigator.wakeLock.request) {
          navigator.wakeLock.request('screen').then(function(lock) {
            self.routeWakeLock = lock;
          }).catch(function() {});
        }
        self.geoWatchId = navigator.geolocation.watchPosition(function(pos) {
          // Ignore inaccurate fixes (cell-tower guesses etc.)
          if (pos.coords.accuracy > 60) { return; }
          var now = L.latLng(pos.coords.latitude, pos.coords.longitude);

          // Arrival: flip the card, stop following the GPS. The card offers
          // the landlord's WhatsApp and stays until closed.
          if (!arrived && KKR && KKR.isArrived(now.distanceTo(destLatLng))) {
            arrived = true;
            state = 'arrived';
            render();
            if (navigator.vibrate) { navigator.vibrate([200, 100, 200]); }
            if (self.geoWatchId != null) {
              navigator.geolocation.clearWatch(self.geoWatchId);
              self.geoWatchId = null;
            }
            return;
          }

          // Only re-route after moving ~15 meters, at most every 10 seconds.
          if (now.distanceTo(lastRouted) < 15 ||
              Date.now() - lastRouteTime < 10000) { return; }
          lastRouted = now;
          lastRouteTime = Date.now();
          if (self.routingControl) {
            self.routingControl.spliceWaypoints(0, 1, now);
          }
        }, null, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      };

      render();

      navigator.geolocation.getCurrentPosition(function(pos) {
        // Ignore this result if the user ended the route, or started a newer
        // one to a different place, while we waited for the GPS fix.
        if (self.routingDest !== destLatLng) { return; }

        lastRouted = L.latLng(pos.coords.latitude, pos.coords.longitude);
        var saved = null;
        try { saved = window.localStorage.getItem('kk-route-mode'); } catch (e) {}
        profile = KKR ?
          KKR.pickProfile(lastRouted.distanceTo(destLatLng), saved) : 'walking';
        state = 'preview';
        render();
        makeRoute(profile, false);

      }, function(err) {
        self.stopDirections();
        alert('Could not get your location: ' + err.message);
      }, { enableHighAccuracy: true, timeout: 15000 });
    },
    stopDirections: function() {
      if (this.geoWatchId != null) {
        navigator.geolocation.clearWatch(this.geoWatchId);
        this.geoWatchId = null;
      }
      if (this.routingControl) {
        this.map.removeControl(this.routingControl);
        this.routingControl = null;
      }
      if (this.$routeCard) {
        this.$routeCard.remove();
        this.$routeCard = null;
      }
      if (this.routeWakeLock) {
        try { this.routeWakeLock.release(); } catch (e) {}
        this.routeWakeLock = null;
      }
      if ($('body').hasClass('kk-routing')) {
        $('body').removeClass('kk-routing');
        if (this.map) { this.map.invalidateSize(); }
      }
      this.routingDest = null;
    },
    addLayerView: function(model) {
      this.layerViews[model.cid] = new S.LayerView({
        model: model,
        router: this.options.router,
        map: this.map,
        placeLayers: this.placeLayers,
        placeTypes: this.options.placeTypes,
        userToken: this.options.userToken,
        mapView: this
      });
      this.updateMyPlacesLegend();
    },
    updateMyPlacesLegend: _.debounce(function() {
      var self = this;
      // Show a small "Yours" legend only when at least one of the user's own
      // places is on the map (so the gold color explains itself).
      var hasMine = this.collection.some(function(model) {
        return S.Util.isMyPlace(model, self.options.userToken);
      });
      if (hasMine && !this.$myLegend) {
        this.$myLegend = $(
          '<div class="leaflet-control leaflet-bar my-places-legend"' +
          ' style="background:#fff; padding:4px 9px; font-size:12px; color:#7a5900;' +
          ' display:flex; align-items:center; gap:5px; box-shadow:0 1px 4px rgba(0,0,0,0.3);">' +
          '<span style="width:11px; height:11px; border-radius:50%; background:#E0A400;' +
          ' display:inline-block;"></span>Yours</div>'
        );
        this.$('.leaflet-top.leaflet-left').append(this.$myLegend);
      } else if (!hasMine && this.$myLegend) {
        this.$myLegend.remove();
        this.$myLegend = null;
      }
    }, 150),
    removeLayerView: function(model) {
      this.layerViews[model.cid].remove();
      delete this.layerViews[model.cid];
    },
    zoomInOn: function(latLng) {
      this.map.setView(latLng, this.options.mapConfig.options.maxZoom || 17);
    },

    filter: function(locationType) {
      var self = this;
      console.log('filter the map', arguments);
      this.locationTypeFilter = locationType;
      this.collection.each(function(model) {
        var modelLocationType = model.get('location_type');

        if (modelLocationType &&
            modelLocationType.toUpperCase() === locationType.toUpperCase()) {
          self.layerViews[model.cid].show();
        } else {
          self.layerViews[model.cid].hide();
        }
      });
    },

    clearFilter: function() {
      var self = this;
      this.locationTypeFilter = null;
      this.collection.each(function(model) {
        self.layerViews[model.cid].render();
      });
    }
  });

})(Shareabouts, jQuery, Shareabouts.Util.console);
