/*globals Backbone _ jQuery Handlebars */

var Shareabouts = Shareabouts || {};

(function(S, $, console){
  S.PlaceDetailView = Backbone.View.extend({
    initialize: function() {
      var self = this;

      this.surveyType = this.options.surveyConfig.submission_type;
      this.supportType = this.options.supportConfig.submission_type;

      this.model.on('change', this.onChange, this);

      // Make sure the submission collections are set
      this.model.submissionSets[this.surveyType] = this.model.submissionSets[this.surveyType] ||
        new S.SubmissionCollection(null, {
          submissionType: this.surveyType,
          placeModel: this.model
        });

      this.model.submissionSets[this.supportType] = this.model.submissionSets[this.supportType] ||
        new S.SubmissionCollection(null, {
          submissionType: this.supportType,
          placeModel: this.model
        });


      this.surveyView = new S.SurveyView({
        collection: this.model.submissionSets[this.surveyType],
        surveyConfig: this.options.surveyConfig,
        userToken: this.options.userToken
      });

      this.supportView = new S.SupportView({
        collection: this.model.submissionSets[this.supportType],
        supportConfig: this.options.supportConfig,
        userToken: this.options.userToken
      });

      this.$el.on('click', '.share-link a', function(evt){

        // HACK! Each action should have its own view and bind its own events.
        var shareTo = this.getAttribute('data-shareto');

        S.Util.log('USER', 'place', shareTo, self.model.getLoggingDetails());
      });

      this.$el.on('click', '.toggle-visibility', _.bind(this.onToggleVisibility, this));
    this.$el.on('click', '.delete-place', _.bind(this.onDeletePlace, this));

      this.$el.on('click', '.get-directions', function(evt) {
        evt.preventDefault();
        $(S).trigger('getdirections', [L.latLng(+$(this).data('lat'), +$(this).data('lng')), self.model]);
      });

      // Easy share: use the phone's native share sheet (WhatsApp, Facebook,
      // Messages, Copy...) when available, otherwise copy the link.
      this.$el.on('click', '.share-place', function(evt) {
        evt.preventDefault();
        var placeId = $(this).data('place-id');
        var placeName = $(this).data('place-name') || 'a place';
        var url = window.location.origin + '/place/' + placeId;
        var text = placeName + ' - KothaKhoj';

        if (navigator.share) {
          navigator.share({ title: 'KothaKhoj', text: text, url: url })
            .catch(function() {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function() {
            alert('Link copied! You can now paste it anywhere.');
          }, function() {
            window.prompt('Copy this link to share:', url);
          });
        } else {
          window.prompt('Copy this link to share:', url);
        }
        S.Util.log('USER', 'place', 'share', self.model.getLoggingDetails());
      });
    },

    getTemplateContext: function(isNew) {
      const context = _.extend({
        place_config: this.options.placeConfig,
        survey_config: this.options.surveyConfig,
        support_config: this.options.supportConfig,
        is_new: isNew,
      }, this.model.toJSON());

      context.submitter_name = this.model.get('submitter_name') || this.options.placeConfig.anonymous_name;

      // Augment the template data with the attachments list
      context.attachments = this.model.attachmentCollection.toJSON();

      return context;
    },

    render: function(isNew) {
      var self = this,
          data = this.getTemplateContext(isNew);

      this.$el.html(Handlebars.templates['place-detail'](data));

    // Show the delete button when the server will accept the delete. A
    // signed-in poster owns their place by ACCOUNT, so match on the current
    // user's username against the place's submitter — this follows their
    // login to any device. Fall back to the legacy session-token match for
    // places created anonymously. Device-bound places (shared college
    // accounts) only offer Delete on the device that created them — the
    // server enforces the same rule with the stored device token.
    var currentUser = S.bootstrapped && S.bootstrapped.currentUser;
    var submitter = this.model.get('submitter');
    var ownedByAccount = !!(currentUser && submitter &&
                            submitter.username && submitter.username === currentUser.username);
    var ownedByToken = !!(this.options.userToken &&
                          this.model.get('user_token') === this.options.userToken);
    var deviceBound = !!this.model.get('device_bound');
    var isMine = _.contains(S.Util.getMyPlaceIds(), this.model.id);
    var KKRules = window.KothaKhoj && window.KothaKhoj.deviceRules;
    var canDelete = KKRules
        ? KKRules.canDelete(deviceBound, ownedByAccount, isMine, ownedByToken)
        : (ownedByAccount || ownedByToken);
    if (canDelete) {
      this.$el.find('.place-header').after(
        $('<div class="place-delete-bar"><button class="delete-place btn">Delete this place</button></div>')
      );
    }

      // Render the view as-is (collection may have content already)
      this.$('.survey').html(this.surveyView.render().$el);
      // Fetch for submissions and automatically update the element
      this.model.submissionSets[this.surveyType].fetchAllPages();

      this.$('.support').html(this.supportView.render().$el);
      // Fetch for submissions and automatically update the element
      this.model.submissionSets[this.supportType].fetchAllPages();

      return this;
    },

    remove: function() {
      this.model.off('change', this.onChange);
      this.$el.off('click', '.share-link a');
      this.$el.off('click', '.get-directions');
      this.$el.off('click', '.share-place');
    },

    onChange: function() {
      this.render();
    },

    onDeletePlace: function(evt) {
      var self = this;
      if (!confirm('Are you sure you want to delete this place? This cannot be undone.')) { return; }

      var $button = this.$(evt.target);
      $button.attr('disabled', 'disabled');

      var model = this.model;
      var collection = this.model.collection;

      this.model.destroy({
        wait: true,
        success: function() {
          S.Util.log('USER', 'deleted-place', 'successfully-deleted-place');
          // Make sure the marker leaves the map immediately.
          if (collection) { collection.remove(model); }
          self.remove();                    // tear down this detail view cleanly
          S.Util.log('APP', 'panel-state', 'close');
          Backbone.history.navigate('/', { trigger: true });   // soft route home
        },
        error: function(m, response) {
          S.Util.log('USER', 'deleted-place', 'fail-to-delete-place');
          if (response && response.status === 403) {
            alert('This place can no longer be deleted from this browser, ' +
                  'because your session has changed. Please email ' +
                  'kothakhoj4@gmail.com and we will remove it for you.');
          } else {
            alert('Could not delete this place. Please try again.');
          }
          $button.removeAttr('disabled');
        }
      });
    },

    onToggleVisibility: function(evt) {
      var $button = this.$(evt.target);
      $button.attr('disabled', 'disabled');

      this.model.save({visible: !this.model.get('visible')}, {
        beforeSend: function($xhr) {
          $xhr.setRequestHeader('X-Shareabouts-Silent', 'true');
        },
        success: function() {
          S.Util.log('USER', 'updated-place-visibility', 'successfully-edit-place');
        },
        error: function() {
          S.Util.log('USER', 'updated-place-visibility', 'fail-to-edit-place');
        },
        complete: function() {
          $button.removeAttr('disabled');
        },
        wait: true
      });
    }
  });
}(Shareabouts, jQuery, Shareabouts.Util.console));
