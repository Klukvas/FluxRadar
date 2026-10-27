/* Content language, cookie consent and consent-gated analytics. Header interactions belong to site-chrome. */
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
    'content.sections': { en: 'Resource sections', uk: 'Розділи матеріалів' },
    'content.search': { en: 'Find an article', uk: 'Знайти матеріал' },
    'content.category': { en: 'Topic', uk: 'Тема' },
    'content.all': { en: 'All topics', uk: 'Усі теми' },
    'content.reset': { en: 'Reset filters', uk: 'Скинути фільтри' },
    'content.legacy': { en: 'Previous articles', uk: 'Попередні матеріали' },
    'content.blog': { en: 'Blog', uk: 'Блог' },
    'content.guides': {
      en: 'Knowledge base: 20 practical guides in Ukrainian',
      uk: 'База знань: 20 покрокових інструкцій',
    },
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
  };

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
    return isLanguage(stored) ? stored : 'uk';
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
      syncLanguageControls(language);
      document.dispatchEvent(
        new window.CustomEvent('fluxradar:content-language', { detail: language }),
      );
      renderCookieControls(language);
      return;
    }
    root.setAttribute('data-blog-lang', language);
    root.lang = language;
    storeLanguage(language);
    updateEmptyState(language);
    syncLanguageControls(language);
    document.dispatchEvent(new window.Event('content-language-change'));
    document.dispatchEvent(
      new window.CustomEvent('fluxradar:content-language', { detail: language }),
    );
    if (options && options.pushUrl) {
      var url = language === 'uk' ? '/blog' : '/blog?lang=en';
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
    var section = document.body.getAttribute('data-content-section');
    var destination =
      section === 'knowledge-base' && language === 'uk'
        ? '/knowledge-base'
        : language === 'en'
          ? '/blog?lang=en'
          : '/blog';
    window.location.assign(destination);
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

  document.addEventListener('fluxradar:content-language-request', function (event) {
    if (isLanguage(event.detail)) chooseLanguage(event.detail);
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
