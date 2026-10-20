// Fixed public campaign labels only; called by blog.js after analytics consent.
(function () {
  function approvedAttribution(search) {
    var pairs = {
      instagram: 'social',
      google: 'organic',
      bing: 'organic',
      chatgpt: 'referral',
      perplexity: 'referral',
      claude: 'referral',
      newsletter: 'email',
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
    if (media.length !== 1 || !Object.hasOwn(pairs, sources[0]) || pairs[sources[0]] !== media[0])
      return null;
    return { campaign_source: sources[0], campaign_medium: media[0] };
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
})();
