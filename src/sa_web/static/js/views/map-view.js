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

      var onLocationError = function(evt) {
        var message;
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
        if(!self.map.options.maxBounds ||self.map.options.maxBounds.contains(evt.latlng)) {
          self.map.setView(evt.latlng, 18);
        } else {
          msg = 'It looks like you\'re not in a place where we\'re collecting ' +
            'data. I\'m going to leave the map where it is, okay?';
          alert(msg);
        }
      };

      // Add the geolocation control link
      this.$('.leaflet-top.leaflet-right').append(
        '<div class="leaflet-control leaflet-bar">' +
          '<a href="#" class="locate-me" role="button" title="Center on my location" aria-label="Center on my location"></a>' +
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
      this.geolocate();
    },
    geolocate: function() {
      this.map.locate({ enableHighAccuracy: true, maximumAge: 0 });
    },
    startDirections: function(destLatLng) {
      var self = this;
      this.stopDirections();

      if (!navigator.geolocation) {
        alert('Your browser does not support location. Directions are not available.');
        return;
      }

      this.routingDest = destLatLng;

      // Show immediate feedback (and a cancel button) while GPS is searching.
      this.$endRouteControl = $(
        '<div class="leaflet-control leaflet-bar end-route-control">' +
          '<a href="#" role="button" title="End route" aria-label="End route"' +
            ' style="width:auto; padding:0 10px; font-weight:bold;' +
            ' color:#c0392b; white-space:nowrap;">Locating&hellip;</a>' +
        '</div>'
      );
      this.$endRouteControl.on('click', 'a', function(evt) {
        evt.preventDefault();
        evt.stopPropagation();
        self.stopDirections();
      });
      this.$endRouteControl.on('mousedown dblclick touchstart', function(evt) {
        evt.stopPropagation();
      });
      this.$('.leaflet-top.leaflet-right').append(this.$endRouteControl);

      navigator.geolocation.getCurrentPosition(function(pos) {
        // Ignore this result if the user ended the route, or started a newer
        // one to a different place, while we waited for the GPS fix.
        if (self.routingDest !== destLatLng) { return; }

        var here = L.latLng(pos.coords.latitude, pos.coords.longitude);

        // Build the route for a given travel profile. Walking gives the
        // shortest door-to-door path for nearby places, but Mapbox walking
        // has a maximum distance; if it fails, fall back to driving once.
        var makeRoute = function(profile, isFallback) {
          self.routingControl = L.Routing.control({
            waypoints: [here, destLatLng],
            router: L.Routing.mapbox(S.bootstrapped.mapboxToken, { profile: 'mapbox/' + profile }),
            fitSelectedRoutes: true,
            addWaypoints: false,
            draggableWaypoints: false,
            show: false,
            collapsible: true
          }).addTo(self.map);

          // Fit the map to the route once, then leave the user's view alone
          // while they move (no re-zoom on every re-route).
          self.routingControl.on('routesfound', function() {
            if (self.routingControl) {
              self.routingControl.options.fitSelectedRoutes = false;
            }
          });

          self.routingControl.on('routingerror', function() {
            if (!isFallback) {
              // Walking route failed (usually too far) - try driving instead.
              if (self.routingControl) {
                self.map.removeControl(self.routingControl);
                self.routingControl = null;
              }
              makeRoute('driving', true);
            } else {
              self.stopDirections();
              alert('Could not find a route to this place.');
            }
          });
        };

        makeRoute('walking', false);

        // Route is being calculated: flip the control from "Locating" to the
        // real End Route label.
        if (self.$endRouteControl) {
          self.$endRouteControl.find('a').html('&#10005; End Route');
        }

        var lastRouted = here;
        self.geoWatchId = navigator.geolocation.watchPosition(function(pos) {
          // Ignore inaccurate fixes (cell-tower guesses etc.)
          if (pos.coords.accuracy > 60) { return; }
          var now = L.latLng(pos.coords.latitude, pos.coords.longitude);
          // Only re-route after moving ~15 meters
          if (now.distanceTo(lastRouted) < 15) { return; }
          lastRouted = now;
          if (self.routingControl) {
            self.routingControl.spliceWaypoints(0, 1, now);
          }
        }, null, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });

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
      if (this.$endRouteControl) {
        this.$endRouteControl.remove();
        this.$endRouteControl = null;
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
