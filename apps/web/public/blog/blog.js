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
  var CONSENT_KEY = 'fluxradar.cookieConsent';
  var CONSENT_VERSION = 'v2';
  // v1 predates the analytics category. It is no longer an answer, but the
  // language permission it gave still stands for the rest of its 180 days.
  var LEGACY_CONSENT_VERSION = 'v1';
  var CONSENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
  var MAX_TIMEOUT_MS = 2147483647;
  var cookieSaveFailed = false;

  // The same GA4 stream as src/analytics-config.ts; blog-page.test.ts keeps the
  // two copies equal. Nothing is requested from Google before the visitor allows
  // analytics, and never on a host other than production.
  var GA_MEASUREMENT_ID = 'G-0N0B548CGE';
  var GA_SCRIPT_ORIGIN = 'https://www.googletagmanager.com';
  var ANALYTICS_HOSTNAME = 'fluxradar.net';
  var GA_SCRIPT_ID = 'fluxradar-ga';

  var TEXT = {
    'nav.navigate': { en: 'Navigate', uk: 'Навігація' },
    'nav.system': { en: 'System', uk: 'Система' },
    'nav.home': { en: 'Home', uk: 'Головна' },
    // The workspace tabs the product header lists. They are disabled here for
    // the same reason they are disabled on every other page served to a reader
    // without a session — the blog is flat files and has no session at all —
    // but the row itself has to be the row the rest of the site shows.
    'nav.profiles': { en: 'Profiles', uk: 'Профілі' },
    'nav.scan': { en: 'Scan', uk: 'Перевірка' },
    'nav.reports': { en: 'Reports', uk: 'Звіти' },
    'nav.integrations': { en: 'Integrations', uk: 'Інтеграції' },
    'nav.profilesHint': {
      en: 'Your saved profiles and their audit history.',
      uk: 'Ваші збережені профілі та історія їхніх перевірок.',
    },
    'nav.scanHint': {
      en: 'Set up and start a new audit.',
      uk: 'Налаштуйте та запустіть нову перевірку.',
    },
    'nav.reportsHint': {
      en: 'Completed and in-progress audit results.',
      uk: 'Готові та поточні результати перевірок.',
    },
    'nav.integrationsHint': {
      en: 'Optional data connections. The public-site scan works without them.',
      uk: 'Необовʼязкові підключення даних. Публічна перевірка працює без них.',
    },
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
    // The key predates the wording. It credits the studio that built FluxRadar,
    // which is what both locales now say; the key itself is the contract every
    // static page carries in `data-t`, so it keeps its name.
    'blog.poweredBy': { en: 'Created by FluxLab', uk: 'Створено FluxLab' },
    // The link leaves the site, so the accessible name says so before it is followed.
    'blog.poweredByAria': {
      en: 'Created by FluxLab (opens in a new tab)',
      uk: 'Створено FluxLab (відкривається в новій вкладці)',
    },
  };

  var LANGUAGE_LABELS = { en: 'English', uk: 'Українська' };

  var COOKIE_TEXT = {
    en: {
      title: 'Cookies & storage',
      description:
        'Necessary storage keeps sign-in, checkout and this choice working. The two options below stay off until you turn them on.',
      duration:
        'We remember your choice for 180 days. You can change it anytime in Cookie settings.',
      optionalLegend: 'Optional storage',
      preferences: 'Preferences',
      preferencesHint: 'Remember your interface language on this device.',
      analytics: 'Analytics',
      analyticsHint:
        'Count visits with Google Analytics 4 so we can see which pages help. No advertising and no Google Signals.',
      necessary: 'Only necessary',
      save: 'Save choice',
      allow: 'Allow all',
      details: 'Cookie details',
      settings: 'Cookie settings',
      saveError:
        'Your choice could not be saved. Optional storage is off in this tab. Check your browser storage settings and try again.',
      languageError:
        'Your language could not be saved. Optional preferences are off in this tab. Check your browser storage settings and try again.',
    },
    uk: {
      title: 'Cookies і сховище',
      description:
        'Необхідне сховище забезпечує вхід, оплату та збереження цього вибору. Два параметри нижче вимкнені, доки ви їх не ввімкнете.',
      duration:
        'Ми зберігаємо ваш вибір 180 днів. Його можна змінити будь-коли в налаштуваннях cookies.',
      optionalLegend: 'Необов’язкове сховище',
      preferences: 'Налаштування',
      preferencesHint: 'Запам’ятовувати мову інтерфейсу на цьому пристрої.',
      analytics: 'Аналітика',
      analyticsHint:
        'Рахувати відвідування через Google Analytics 4, щоб ми бачили, які сторінки корисні. Без реклами та Google Signals.',
      necessary: 'Лише необхідні',
      save: 'Зберегти вибір',
      allow: 'Дозволити все',
      details: 'Докладніше про cookies',
      settings: 'Налаштування cookies',
      saveError:
        'Не вдалося зберегти ваш вибір. Необов’язкове сховище вимкнено в цій вкладці. Перевірте налаштування сховища браузера та спробуйте ще раз.',
      languageError:
        'Не вдалося зберегти мову. Додаткові налаштування вимкнено в цій вкладці. Перевірте налаштування сховища браузера та спробуйте ще раз.',
    },
  };

  function isLanguage(value) {
    return LANGUAGES.indexOf(value) !== -1;
  }

  function readStoredLanguage() {
    try {
      if (!preferencesAllowed()) {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storeLanguage(language) {
    try {
      if (!preferencesAllowed()) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // A blocked storage context must not break the filter itself.
    }
  }

  function readParamLanguage() {
    var value = new URLSearchParams(window.location.search).get('lang');
    return isLanguage(value) ? value : null;
  }

  // Match the app's versioned consent (src/browser-consent.ts). Language links
  // and the current filter remain usable without writing optional storage.
  function readStoredRecord() {
    var record = JSON.parse(window.localStorage.getItem(CONSENT_KEY) || 'null');
    return typeof record === 'object' && record !== null && !Array.isArray(record) ? record : null;
  }

  function hasLiveWindow(record) {
    return (
      Number.isSafeInteger(record.updatedAt) &&
      record.updatedAt > 0 &&
      record.updatedAt <= Date.now() &&
      Number.isSafeInteger(record.expiresAt) &&
      record.expiresAt > Date.now() &&
      record.expiresAt - record.updatedAt === CONSENT_TTL_MS
    );
  }

  function readConsentRecord() {
    if (cookieSaveFailed) return null;
    try {
      var record = readStoredRecord();
      return record !== null &&
        record.version === CONSENT_VERSION &&
        typeof record.preferences === 'boolean' &&
        typeof record.analytics === 'boolean' &&
        hasLiveWindow(record)
        ? record
        : null;
    } catch {
      return null;
    }
  }

  function legacyPreferencesAllowed() {
    try {
      var record = readStoredRecord();
      return (
        record !== null &&
        record.version === LEGACY_CONSENT_VERSION &&
        record.preferences === true &&
        hasLiveWindow(record)
      );
    } catch {
      return false;
    }
  }

  function preferencesAllowed() {
    if (cookieSaveFailed) return false;
    var consent = readConsentRecord();
    return consent === null ? legacyPreferencesAllowed() : consent.preferences;
  }

  function analyticsAllowed() {
    return readConsentRecord()?.analytics === true;
  }

  var root = document.documentElement;
  var isIndex = document.body.getAttribute('data-blog-page') === 'index';
  var cookieDock = document.createElement('div');
  cookieDock.className = 'blog-cookie-dock';
  document.body.appendChild(cookieDock);
  var cookieError = null;
  var cookieSettingsOpen = false;
  var cookieExpiryTimer;

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
    var titled = document.querySelectorAll('[data-t-title]');
    for (var t = 0; t < titled.length; t += 1) {
      var tooltip = titled[t];
      var titleEntry = TEXT[tooltip.getAttribute('data-t-title')];
      if (titleEntry !== undefined) tooltip.setAttribute('title', titleEntry[language]);
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
    if (!isIndex) {
      renderCookieControls(language);
      return;
    }
    root.setAttribute('data-blog-lang', language);
    root.lang = language;
    storeLanguage(language);
    updateEmptyState(language);
    syncLanguageControls(language);
    if (options && options.pushUrl) {
      var url = language === 'en' ? '/blog' : '/blog?lang=' + language;
      window.history.replaceState(null, '', url);
    }
    renderCookieControls(language);
  }

  function saveConsentRecord(choice) {
    var updatedAt = Date.now();
    var record = {
      version: CONSENT_VERSION,
      preferences: choice.preferences,
      analytics: choice.analytics,
      updatedAt: updatedAt,
      expiresAt: updatedAt + CONSENT_TTL_MS,
    };
    try {
      if (!choice.preferences) window.localStorage.removeItem(STORAGE_KEY);
      // A refusal removes the earlier allowance first, so a blocked write cannot
      // leave a stale opt-in behind for the next page load.
      if (!choice.preferences || !choice.analytics) window.localStorage.removeItem(CONSENT_KEY);
      var serialized = JSON.stringify(record);
      window.localStorage.setItem(CONSENT_KEY, serialized);
      if (window.localStorage.getItem(CONSENT_KEY) !== serialized) {
        throw new Error('Consent was not stored');
      }
      cookieSaveFailed = false;
      return true;
    } catch {
      cookieSaveFailed = true;
      return false;
    }
  }

  function chooseCookies(choice) {
    if (!saveConsentRecord(choice)) {
      cookieError = 'saveError';
      cookieSettingsOpen = true;
      syncAnalytics();
      renderCookieControls(currentLanguage);
      return;
    }
    if (choice.preferences) {
      try {
        window.localStorage.setItem(STORAGE_KEY, currentLanguage);
      } catch {
        saveConsentRecord({ preferences: false, analytics: choice.analytics });
        cookieError = 'languageError';
        cookieSettingsOpen = true;
        syncAnalytics();
        renderCookieControls(currentLanguage);
        return;
      }
    }
    cookieError = null;
    cookieSettingsOpen = false;
    syncAnalytics();
    renderCookieControls(currentLanguage);
  }

  function cookieButton(label, dataName, onClick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute(dataName, '');
    button.addEventListener('click', onClick);
    return button;
  }

  function appendParagraph(parent, textContent) {
    var paragraph = document.createElement('p');
    paragraph.textContent = textContent;
    parent.appendChild(paragraph);
  }

  /**
   * The two optional categories as checkboxes, ticked from the standing
   * permissions so reopening the settings shows the choice already made.
   */
  function cookieOptions(text) {
    var fieldset = document.createElement('fieldset');
    fieldset.className = 'blog-cookie-consent__options';
    var legend = document.createElement('legend');
    legend.textContent = text.optionalLegend;
    fieldset.appendChild(legend);
    var inputs = {};
    [
      ['preferences', text.preferences, text.preferencesHint, preferencesAllowed()],
      ['analytics', text.analytics, text.analyticsHint, analyticsAllowed()],
    ].forEach(function (option) {
      var id = 'blog-cookie-' + option[0];
      var row = document.createElement('div');
      row.className = 'blog-cookie-consent__option';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = option[3];
      input.setAttribute('data-cookie-option', option[0]);
      input.setAttribute('aria-describedby', id + '-hint');
      var label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = option[1];
      row.append(input, label);
      var hint = document.createElement('p');
      hint.id = id + '-hint';
      hint.className = 'blog-cookie-consent__hint';
      hint.textContent = option[2];
      fieldset.append(row, hint);
      inputs[option[0]] = input;
    });
    return {
      element: fieldset,
      read: function () {
        return { preferences: inputs.preferences.checked, analytics: inputs.analytics.checked };
      },
    };
  }

  function renderCookieControls(language) {
    window.clearTimeout(cookieExpiryTimer);
    cookieDock.replaceChildren();
    var text = COOKIE_TEXT[language];
    var consent = readConsentRecord();
    if (consent !== null && cookieError === null && !cookieSettingsOpen) {
      var launcher = cookieButton(text.settings, 'data-cookie-settings', function () {
        window.clearTimeout(cookieExpiryTimer);
        cookieError = null;
        cookieSettingsOpen = true;
        cookieDock.replaceChildren();
        renderCookiePanel(currentLanguage);
      });
      launcher.className = 'blog-cookie-settings';
      cookieDock.appendChild(launcher);
      cookieExpiryTimer = window.setTimeout(
        function () {
          renderCookieControls(currentLanguage);
        },
        Math.min(consent.expiresAt - Date.now(), MAX_TIMEOUT_MS),
      );
      return;
    }
    renderCookiePanel(language);
  }

  function renderCookiePanel(language) {
    var text = COOKIE_TEXT[language];
    var panel = document.createElement('section');
    panel.className = 'blog-cookie-consent';
    panel.setAttribute('data-cookie-consent', '');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', 'blog-cookie-title');

    var titlebar = document.createElement('div');
    titlebar.className = 'blog-cookie-consent__titlebar';
    var title = document.createElement('h2');
    title.id = 'blog-cookie-title';
    title.textContent = text.title;
    titlebar.appendChild(title);
    panel.appendChild(titlebar);

    var body = document.createElement('div');
    body.className = 'blog-cookie-consent__body';
    appendParagraph(body, text.description);
    var options = cookieOptions(text);
    body.appendChild(options.element);
    appendParagraph(body, text.duration);
    var details = document.createElement('a');
    details.href = '/cookies?lang=' + language;
    details.textContent = text.details;
    body.appendChild(details);
    if (cookieError !== null) {
      var error = document.createElement('p');
      error.className = 'blog-cookie-consent__error';
      error.setAttribute('role', 'alert');
      error.textContent = text[cookieError];
      body.appendChild(error);
    }
    // Three equal buttons: refusing everything is exactly as direct as allowing it.
    var actions = document.createElement('div');
    actions.className = 'blog-cookie-consent__actions';
    actions.appendChild(
      cookieButton(text.necessary, 'data-cookie-choice', function () {
        chooseCookies({ preferences: false, analytics: false });
      }),
    );
    actions.lastElementChild.setAttribute('data-cookie-choice', 'necessary');
    actions.appendChild(
      cookieButton(text.save, 'data-cookie-choice', function () {
        chooseCookies(options.read());
      }),
    );
    actions.lastElementChild.setAttribute('data-cookie-choice', 'save');
    actions.appendChild(
      cookieButton(text.allow, 'data-cookie-choice', function () {
        chooseCookies({ preferences: true, analytics: true });
      }),
    );
    actions.lastElementChild.setAttribute('data-cookie-choice', 'all');
    body.appendChild(actions);
    panel.appendChild(body);
    cookieDock.appendChild(panel);
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

  // ── Analytics ───────────────────────────────────────────────────────────
  // The blog's half of src/analytics.ts: the same consent-gated GA4 tag, and a
  // page view without the query (the blog only ever carries ?lang= there).
  var analyticsActive = false;
  var analyticsLoaded = false;

  function gtag() {
    // gtag.js reads dataLayer entries only as `arguments` objects.
    (window.dataLayer = window.dataLayer || []).push(arguments);
  }

  function setAnalyticsDisabled(disabled) {
    window['ga-disable-' + GA_MEASUREMENT_ID] = disabled;
  }

  function clearAnalyticsCookies() {
    var names = ['_ga', '_ga_' + GA_MEASUREMENT_ID.replace(/^G-/, '')];
    names.forEach(function (name) {
      ['', '; domain=.' + ANALYTICS_HOSTNAME].forEach(function (domain) {
        document.cookie =
          name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=/' + domain;
      });
    });
  }

  function loadAnalytics() {
    setAnalyticsDisabled(false);
    if (analyticsLoaded) return;
    analyticsLoaded = true;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: CONSENT_TTL_MS / 1000,
      cookie_flags: 'SameSite=Lax;Secure',
    });
    var script = document.createElement('script');
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = GA_SCRIPT_ORIGIN + '/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(script);
  }

  function cleanReferrer(referrer) {
    try {
      var url = new window.URL(referrer);
      var path =
        url.origin === window.location.origin
          ? url.pathname.replace(/^\/scans\/[^/]+/, '/scans/:id')
          : url.pathname;
      return url.origin + path;
    } catch {
      return null;
    }
  }

  function sendPageView() {
    var page = {
      page_location: window.location.origin + window.location.pathname,
      page_title: document.title,
    };
    gtag('set', page);
    var referrer = cleanReferrer(document.referrer);
    gtag(
      'event',
      'page_view',
      referrer === null ? page : Object.assign({ page_referrer: referrer }, page),
    );
  }

  function syncAnalytics() {
    var onProduction = window.location.hostname === ANALYTICS_HOSTNAME;
    if (!onProduction || !analyticsAllowed()) {
      if (analyticsActive) setAnalyticsDisabled(true);
      analyticsActive = false;
      if (onProduction) clearAnalyticsCookies();
      return;
    }
    if (analyticsActive) return;
    analyticsActive = true;
    loadAnalytics();
    sendPageView();
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
  syncAnalytics();
  window.addEventListener('storage', function (event) {
    if (event.key === CONSENT_KEY || event.key === null) {
      cookieSaveFailed = false;
      cookieError = null;
      cookieSettingsOpen = false;
      syncAnalytics();
      renderCookieControls(currentLanguage);
    }
  });
  window.addEventListener('focus', function () {
    if (readConsentRecord() !== null) return;
    syncAnalytics();
    renderCookieControls(currentLanguage);
  });
})();
