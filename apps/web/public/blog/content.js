/** Progressive enhancement: all content links remain available without JavaScript. */
(function () {
  'use strict';
  var controls = document.querySelector('[data-content-controls]');
  var search = document.getElementById('content-search');
  var category = document.getElementById('content-category');
  var status = document.querySelector('[data-content-results]');
  if (controls === null || search === null || category === null || status === null) return;
  controls.hidden = false;

  function filterContent() {
    var query = search.value.trim().toLocaleLowerCase('uk');
    var language =
      document.documentElement.getAttribute('data-blog-lang') || document.documentElement.lang;
    search.placeholder =
      language === 'en'
        ? 'For example: website, SEO, crawlers'
        : 'Наприклад: canonical, форма, покриття';
    Array.from(category.querySelectorAll('[data-content-language]')).forEach(function (option) {
      option.hidden = option.getAttribute('data-content-language') !== language;
    });
    var selected = category.selectedOptions[0];
    if (selected && selected.hidden) category.value = '';
    var cards = Array.from(document.querySelectorAll('[data-content-card]'));
    var matches = cards.filter(function (card) {
      var locale = card.closest('[data-article-lang]');
      var isLanguageMatch =
        locale === null || locale.getAttribute('data-article-lang') === language;
      var isCategoryMatch =
        category.value === '' || card.getAttribute('data-category') === category.value;
      var isTextMatch = card.textContent.toLocaleLowerCase('uk').indexOf(query) !== -1;
      card.hidden = !isCategoryMatch || !isTextMatch;
      return isLanguageMatch && !card.hidden;
    });
    Array.from(document.querySelectorAll('[data-content-category]')).forEach(function (section) {
      section.hidden = !Array.from(section.querySelectorAll('[data-content-card]')).some(
        function (card) {
          return !card.hidden;
        },
      );
    });
    status.textContent =
      matches.length > 0
        ? (language === 'en' ? 'Articles found: ' : 'Знайдено матеріалів: ') + matches.length
        : language === 'en'
          ? 'No articles found. Try another topic or reset the filters.'
          : 'Нічого не знайдено. Спробуйте іншу тему або скиньте фільтри.';
  }

  var reset = document.querySelector('[data-content-reset]');
  if (reset !== null)
    reset.addEventListener('click', function () {
      search.value = '';
      category.value = '';
      filterContent();
      search.focus();
    });
  search.addEventListener('input', filterContent);
  category.addEventListener('change', filterContent);
  document.addEventListener('content-language-change', filterContent);
  filterContent();
})();
