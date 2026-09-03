// PRIVACY-002 — public technical consent signal.
// The rule only reports a static signal when a recognizable tracker is loaded
// without a consent marker in the initial HTML. Runtime banners and regional
// legal requirements require a browser/manual review.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('PRIVACY-002');

const TRACKER_HOST_MARKERS = [
  'google-analytics.com',
  'googletagmanager.com',
  'connect.facebook.net',
  'facebook.net',
  'doubleclick.net',
  'hotjar.com',
  'clarity.ms',
  'segment.com',
  'plausible.io',
  'matomo',
] as const;

const TRACKER_CODE_MARKERS = [
  'gtag(',
  'googletagmanager',
  'google-analytics',
  'ga(',
  'fbq(',
  'hotjar',
  'clarity(',
  '_paq.push',
  'dataLayer.push',
] as const;

const CONSENT_MARKERS = [
  'cookie',
  'consent',
  'onetrust',
  'cookiebot',
  'didomi',
  'usercentrics',
  'trustarc',
] as const;

export const privacy002ConsentSignal: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const trackerSignals = trackerSignalsOnPage(page);
    if (trackerSignals.length === 0 || hasConsentMarker(page)) return [];
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence:
          `Обнаружены потенциальные tracker-сигналы (${trackerSignals.join(', ')}), ` +
          'но consent-маркер в исходном HTML не найден',
        recommendation:
          'Проверьте, что необязательные trackers загружаются после явного consent; ' +
          'проверьте banner и поведение до/после согласия в браузере для нужной юрисдикции.',
        resource: 'consent-static-signal',
        confidence: 0.8,
      }),
    ];
  },
};

function trackerSignalsOnPage(page: PageSnapshot): readonly string[] {
  if (page.html === null) return [];
  const root = parsePage(page);
  const signals = new Set<string>();
  for (const script of root.querySelectorAll('script')) {
    const src = (script.getAttribute('src') ?? '').toLowerCase();
    const raw = script.rawText.toLowerCase();
    for (const marker of TRACKER_HOST_MARKERS) {
      if (src.includes(marker)) signals.add(marker);
    }
    for (const marker of TRACKER_CODE_MARKERS) {
      if (raw.includes(marker)) signals.add(marker);
    }
  }
  return [...signals].sort();
}

function hasConsentMarker(page: PageSnapshot): boolean {
  if (page.html === null) return false;
  const root = parsePage(page);
  // Do not scan all document copy: a content paragraph mentioning cookies is
  // not a consent control. Restrict the signal to control/landmark text,
  // identifying attributes, and known CMP script URLs.
  const controlText = root
    .querySelectorAll('button, [role="dialog"], [role="banner"], [role="alert"], [id], [class]')
    .map((element) => {
      const attributes = ['id', 'class', 'aria-label', 'data-testid', 'data-consent']
        .map((name) => element.getAttribute(name) ?? '')
        .join(' ');
      return `${attributes} ${element.text}`;
    })
    .join(' ')
    .toLowerCase();
  return CONSENT_MARKERS.some((marker) => controlText.includes(marker));
}
