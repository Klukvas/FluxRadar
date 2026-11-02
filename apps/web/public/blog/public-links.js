// Fixed public destinations only; article and content links retain their own URLs.
//
// The locale here is the reader's interface locale, not the blog's article
// filter. The blog and the knowledge base are written in English and Ukrainian
// only, so a Russian reader reads a Ukrainian article list — but Home and FAQ
// must still take them back to the Russian pages they came from, and the
// prefixes have to agree with apps/web/src/public-page-routing.ts.
(function () {
  var PREFIX = { en: '', uk: '/uk', ru: '/ru' };
  window.fluxradarPublicLinks = function (language) {
    var prefix = PREFIX[language] || '';
    var home = prefix === '' ? '/' : prefix;
    var faq = prefix + '/faq';
    document
      .querySelectorAll(
        '.menubar__apple, .menubar a[data-t="nav.home"], .site-footer a[data-t="blog.footerHome"]',
      )
      .forEach(function (link) {
        link.setAttribute('href', home);
      });
    document.querySelectorAll('.menubar a[data-t="nav.faq"]').forEach(function (link) {
      link.setAttribute('href', faq);
    });
  };
})();
