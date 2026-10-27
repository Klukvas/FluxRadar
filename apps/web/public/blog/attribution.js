// Fixed public campaign labels only; called by blog.js after analytics consent.
// The src/analytics-attribution.ts half of the same rules; the two are held
// equal by analytics-attribution.test.ts.
(function () {
  // Google carries two: organic is a link in a profile or an answer, cpc the
  // Search campaign.
  var GOOGLE_CLICK_ID = /^[A-Za-z0-9_-]{1,200}$/;

  function approvedAttribution(search) {
    var pairs = {
      instagram: ['social'],
      google: ['organic', 'cpc'],
      bing: ['organic'],
      chatgpt: ['referral'],
      perplexity: ['referral'],
      claude: ['referral'],
      newsletter: ['email'],
    };
    var params = new URLSearchParams(search);
    var sources = params.getAll('utm_source');
    var media = params.getAll('utm_medium');
    if (sources.length !== 1) return null;
    if (sources[0] === 'chatgpt.com') {
      return media.length === 0 || (media.length === 1 && media[0] === 'referral')
        ? { campaign_source: 'chatgpt', campaign_medium: 'referral' }
        : null;
    }
    if (
      media.length !== 1 ||
      !Object.hasOwn(pairs, sources[0]) ||
      pairs[sources[0]].indexOf(media[0]) === -1
    )
      return null;
    return { campaign_source: sources[0], campaign_medium: media[0] };
  }

  /** The Google Ads click id, and nothing else a query may hold. */
  function approvedClickId(search) {
    var ids = new URLSearchParams(search).getAll('gclid');
    if (ids.length !== 1) return null;
    return GOOGLE_CLICK_ID.test(ids[0]) ? ids[0] : null;
  }

  function cleanReferrer(referrer) {
    try {
      var url = new window.URL(referrer);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      var path =
        url.origin === window.location.origin
          ? url.pathname.replace(/^\/scans\/[^/]+/, '/scans/:id')
          : '/';
      return url.origin + path;
    } catch {
      return null;
    }
  }

  window.fluxradarCleanReferrer = cleanReferrer;
  window.fluxradarApprovedAttribution = approvedAttribution;
  window.fluxradarApprovedClickId = approvedClickId;
})();
