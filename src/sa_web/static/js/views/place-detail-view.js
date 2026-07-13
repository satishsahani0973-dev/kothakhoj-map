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
        $(S).trigger('getdirections', [L.latLng(+$(this).data('lat'), +$(this).data('lng'))]);
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

    if (this.options.userToken && this.model.get('user_token') === this.options.userToken) {
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
    },

    onChange: function() {
      this.render();
    },

    onDeletePlace: function(evt) {
      var self = this;
      if (!confirm('Are you sure you want to delete this place? This cannot be undone.')) { return; }

      var $button = this.$(evt.target);
      $button.attr('disabled', 'disabled');

      this.model.destroy({
        wait: true,
        success: function() {
  S.Util.log('USER', 'deleted-place', 'successfully-deleted-place');
  self.remove();                    // tear down this detail view cleanly
  S.Util.log('APP', 'panel-state', 'close');
  Backbone.history.navigate('/', { trigger: true });   // soft route home, no full reload
},
        error: function() {
          S.Util.log('USER', 'deleted-place', 'fail-to-delete-place');
          alert('Could not delete this place. Please try again.');
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
