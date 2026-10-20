// Fixed public destinations only; article and content links retain their own URLs.
(function () {
  window.fluxradarPublicLinks = function (language) {
    var home = language === 'uk' ? '/uk' : '/';
    var faq = language === 'uk' ? '/uk/faq' : '/faq';
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
