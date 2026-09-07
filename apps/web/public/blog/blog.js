/*
 * Shared behaviour for every static blog page.
 *
 * Three things live here, and they are the three the React header also does:
 * the full-screen burger sheet, the language combobox (which closes on an
 * outside click and on Escape), and the language choice itself. On the blog
 * index that choice is a real filter — it hides the articles written in the
 * other language and re-labels the page — and on an article page it takes the
 * reader to the index already filtered, because a single-language article has
 * no translated twin to switch to.
 *
 * The chrome ships in English in the HTML, so a reader with JavaScript off
 * still gets a readable page; this file only swaps it when Ukrainian is chosen.
 */
(function () {
  'use strict';

  var LANGUAGES = ['en', 'uk'];
  // The same key the app writes, so a language chosen here survives the jump
  // from /blog back to the product and the other way round.
  var STORAGE_KEY = 'fluxradar.language';

  var TEXT = {
    'nav.navigate': { en: 'Navigate', uk: 'Навігація' },
    'nav.system': { en: 'System', uk: 'Система' },
    'nav.home': { en: 'Home', uk: 'Головна' },
    'nav.faq': { en: 'FAQ', uk: 'FAQ' },
    'nav.blog': { en: 'Blog', uk: 'Блог' },
    'nav.language': { en: 'Language', uk: 'Мова' },
    'nav.systemStatus': {
      en: 'PUBLIC WEB AUDIT STATION · v0.1',
      uk: 'СТАНЦІЯ АУДИТУ ПУБЛІЧНИХ САЙТІВ · v0.1',
    },
    'nav.openMenu': { en: 'Open menu', uk: 'Відкрити меню' },
    'nav.closeMenu': { en: 'Close menu', uk: 'Закрити меню' },
    'blog.kicker': { en: 'PUBLIC WEBSITE OPERATIONS', uk: 'ЕКСПЛУАТАЦІЯ ПУБЛІЧНИХ САЙТІВ' },
    'blog.title': {
      en: 'Field notes for healthier websites.',
      uk: 'Польові нотатки для здоровіших сайтів.',
    },
    'blog.lede': {
      en: 'Evidence-led notes on the signals that search engines, AI crawlers and users can observe without private credentials. Available in English and Ukrainian.',
      uk: 'Нотатки на основі доказів про сигнали, які пошукові системи, AI-краулери та люди бачать без приватних доступів. Доступно англійською та українською.',
    },
    'blog.filterLabel': { en: 'Language:', uk: 'Мова:' },
    'blog.empty': {
      en: 'No articles in this language yet. Switch the language filter to see the rest.',
      uk: 'Статей цією мовою поки немає. Змініть фільтр мови, щоб побачити решту.',
    },
    'blog.footerHome': {
      en: 'FluxRadar — public website audits',
      uk: 'FluxRadar — аудит публічних сайтів',
    },
    'blog.poweredBy': { en: 'Powered by FluxLab', uk: 'Працює на FluxLab' },
    // The link leaves the site, so the accessible name says so before it is followed.
    'blog.poweredByAria': {
      en: 'Powered by FluxLab (opens in a new tab)',
      uk: 'Працює на FluxLab (відкривається в новій вкладці)',
    },
  };

  var LANGUAGE_LABELS = { en: 'English', uk: 'Українська' };

  function isLanguage(value) {
    return LANGUAGES.indexOf(value) !== -1;
  }

  function readStoredLanguage() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storeLanguage(language) {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // A blocked storage context must not break the filter itself.
    }
  }

  function readParamLanguage() {
    var value = new URLSearchParams(window.location.search).get('lang');
    return isLanguage(value) ? value : null;
  }

  var root = document.documentElement;
  var isIndex = document.body.getAttribute('data-blog-page') === 'index';

  /**
   * The index offers both languages, so its filter decides; an article page is
   * written in one language and says so in its own `lang` attribute.
   */
  function initialLanguage() {
    if (!isIndex) return isLanguage(root.lang) ? root.lang : 'en';
    var requested = readParamLanguage();
    if (requested !== null) return requested;
    var stored = readStoredLanguage();
    return isLanguage(stored) ? stored : 'en';
  }

  function translateChrome(language) {
    var nodes = document.querySelectorAll('[data-t]');
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var entry = TEXT[node.getAttribute('data-t')];
      if (entry !== undefined) node.textContent = entry[language];
    }
    var labelled = document.querySelectorAll('[data-t-label]');
    for (var i = 0; i < labelled.length; i += 1) {
      var target = labelled[i];
      var labelEntry = TEXT[target.getAttribute('data-t-label')];
      if (labelEntry !== undefined) target.setAttribute('aria-label', labelEntry[language]);
    }
  }

  function updateEmptyState(language) {
    var empty = document.querySelector('[data-blog-empty]');
    if (empty === null) return;
    var visible = document.querySelectorAll('[data-article-lang="' + language + '"] article');
    empty.hidden = visible.length > 0;
  }

  var currentLanguage = initialLanguage();

  function applyLanguage(language, options) {
    currentLanguage = language;
    translateChrome(language);
    if (!isIndex) return;
    root.setAttribute('data-blog-lang', language);
    root.lang = language;
    storeLanguage(language);
    updateEmptyState(language);
    syncLanguageControls(language);
    if (options && options.pushUrl) {
      var url = language === 'en' ? '/blog' : '/blog?lang=' + language;
      window.history.replaceState(null, '', url);
    }
  }

  function syncLanguageControls(language) {
    var options = document.querySelectorAll('[data-language-option]');
    for (var index = 0; index < options.length; index += 1) {
      var option = options[index];
      var selected = option.getAttribute('data-language-option') === language;
      option.setAttribute('aria-selected', String(selected));
      option.classList.toggle('is-active', selected);
    }
    var current = document.querySelector('[data-language-current]');
    if (current !== null) current.textContent = LANGUAGE_LABELS[language];
    var filters = document.querySelectorAll('[data-language-filter]');
    for (var i = 0; i < filters.length; i += 1) {
      var filter = filters[i];
      filter.setAttribute(
        'aria-pressed',
        String(filter.getAttribute('data-language-filter') === language),
      );
    }
  }

  /** Article pages have no translated twin, so the choice goes to the filtered index. */
  function chooseLanguage(language) {
    if (isIndex) {
      applyLanguage(language, { pushUrl: true });
      return;
    }
    storeLanguage(language);
    window.location.assign(language === 'en' ? '/blog' : '/blog?lang=' + language);
  }

  // ── Burger sheet ────────────────────────────────────────────────────────
  var toggle = document.querySelector('[data-menu-toggle]');
  var sheet = document.getElementById('menubar-links');
  var closeButton = document.querySelector('[data-menu-close]');

  function setMenuOpen(open) {
    if (toggle === null || sheet === null) return;
    sheet.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open && closeButton !== null) closeButton.focus();
    if (!open) toggle.focus();
  }

  if (toggle !== null && sheet !== null) {
    toggle.addEventListener('click', function () {
      setMenuOpen(!sheet.classList.contains('is-open'));
    });
  }
  if (closeButton !== null) {
    closeButton.addEventListener('click', function () {
      setMenuOpen(false);
    });
  }

  // ── Language combobox ───────────────────────────────────────────────────
  var languageBox = document.querySelector('[data-language]');
  var languageButton = document.querySelector('[data-language-button]');
  var listbox = document.getElementById('menubar-language-listbox');

  function setListboxOpen(open) {
    if (languageButton === null || listbox === null) return;
    listbox.hidden = !open;
    languageButton.setAttribute('aria-expanded', String(open));
    if (open) {
      var active = listbox.querySelector('[aria-selected="true"]') || listbox.firstElementChild;
      if (active !== null) active.focus();
    }
  }

  function isListboxOpen() {
    return listbox !== null && listbox.hidden === false;
  }

  if (languageButton !== null && listbox !== null) {
    languageButton.addEventListener('click', function () {
      setListboxOpen(!isListboxOpen());
    });
    var optionNodes = listbox.querySelectorAll('[data-language-option]');
    for (var index = 0; index < optionNodes.length; index += 1) {
      (function (option) {
        option.setAttribute('tabindex', '-1');
        option.addEventListener('click', function () {
          setListboxOpen(false);
          chooseLanguage(option.getAttribute('data-language-option'));
        });
        option.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setListboxOpen(false);
            chooseLanguage(option.getAttribute('data-language-option'));
          } else if (event.key === 'ArrowDown' && option.nextElementSibling !== null) {
            event.preventDefault();
            option.nextElementSibling.focus();
          } else if (event.key === 'ArrowUp' && option.previousElementSibling !== null) {
            event.preventDefault();
            option.previousElementSibling.focus();
          }
        });
      })(optionNodes[index]);
    }
  }

  // One listener for both overlays: a click outside the language menu closes
  // it, which is what a reader expects from a dropdown that covers the page.
  document.addEventListener('pointerdown', function (event) {
    if (!isListboxOpen()) return;
    if (languageBox !== null && languageBox.contains(event.target)) return;
    setListboxOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (isListboxOpen()) {
      setListboxOpen(false);
      if (languageButton !== null) languageButton.focus();
      return;
    }
    if (sheet !== null && sheet.classList.contains('is-open')) setMenuOpen(false);
  });

  // ── Filter bar (index only) ─────────────────────────────────────────────
  var filterButtons = document.querySelectorAll('[data-language-filter]');
  for (var filterIndex = 0; filterIndex < filterButtons.length; filterIndex += 1) {
    (function (button) {
      button.addEventListener('click', function () {
        chooseLanguage(button.getAttribute('data-language-filter'));
      });
    })(filterButtons[filterIndex]);
  }

  applyLanguage(currentLanguage, { pushUrl: false });
  syncLanguageControls(currentLanguage);
})();
