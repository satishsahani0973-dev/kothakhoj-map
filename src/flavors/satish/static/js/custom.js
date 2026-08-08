/*globals jQuery */
// KothaKhoj flavor behaviors, loaded after the app scripts on every page.
// Keep all flavor JS here: <script> tags inside jstemplates break the
// inline {% handlebarsjs %} embed in base.html.
(function($) {

  // Live preview under the add-a-room form: show the computed free-from
  // date as soon as a stay length is chosen, so a wrong choice is visible
  // before submitting.
  var MONTHS = { '3m': 3, '6m': 6, '1y': 12, '2y': 24, '3y': 36 };
  $(document).on('change', '.place-form select[name="stay_duration"]', function() {
    var $preview = $('.stay-duration-preview'),
        val = this.value;
    if (!val) {
      $preview.addClass('is-hidden');
    } else if (val === 'now') {
      $preview.removeClass('is-hidden').text('→ This room will show as Available now');
    } else {
      var d = new Date();
      d.setMonth(d.getMonth() + MONTHS[val]);
      $preview.removeClass('is-hidden').text('→ This room will show as Free from ' +
        d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
    }
  });

  // The sign-in panel form posts to Django, which needs the CSRF token the
  // map page set as a cookie. Fill it just before the POST leaves.
  $(document).on('submit', '.signin-form', function() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) { $(this).find('input[name="csrfmiddlewaretoken"]').val(m[1]); }
  });

})(jQuery);
