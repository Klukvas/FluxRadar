// Фикстурные тесты Accessibility-правил (D-025): A11Y-002 (img без alt,
// evidence-группа с SEO-ONPAGE-005 по §14) и A11Y-004 (controls без label).

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import type { SiteContext } from '../engine/types.js';
import { renderFindingMessage } from '../messages/index.js';
import { htmlContext, loadFixtureContext, runRule } from '../testing/fixture-harness.js';

function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  expect(candidates).toHaveLength(1);
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('ожидался ровно один finding');
  }
  return first;
}

describe('A11Y-002 alt-тексты', () => {
  it('positive: <img> без alt → finding (Medium) с selector первого', () => {
    const finding = single(
      runRule('Accessibility', 'A11Y-002', loadFixtureContext('fx-A11Y-002-positive.html')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.normalizedSelector).toBe('img[src="/img/hero.png"]');
    expect(finding.evidenceGroupId).toMatch(/^evg-v1:/);
  });

  it('negative: alt заполнен или пустой alt="" (декоративное) → пусто', () => {
    expect(
      runRule('Accessibility', 'A11Y-002', loadFixtureContext('fx-A11Y-002-negative.html')),
    ).toEqual([]);
  });

  it('§14: у A11Y-002 и SEO-ONPAGE-005 общий evidenceGroupId и разные fingerprint', () => {
    const ctx = loadFixtureContext('fx-A11Y-002-positive.html');
    const a11y = single(runRule('Accessibility', 'A11Y-002', ctx));
    const seo = single(runRule('SEO', 'SEO-ONPAGE-005', ctx));
    expect(a11y.evidenceGroupId).toBeDefined();
    expect(a11y.evidenceGroupId).toBe(seo.evidenceGroupId);
    expect(a11y.fingerprint).not.toBe(seo.fingerprint);
  });
});

describe('A11Y-004 labels у форм', () => {
  it('positive: input без label → finding с selector элемента', () => {
    const finding = single(
      runRule('Accessibility', 'A11Y-004', loadFixtureContext('fx-A11Y-004-positive.html')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.normalizedSelector).toBe('input[name="nickname"]');
  });

  it('negative: label[for], обёртка, aria-label/labelledby, hidden, submit → пусто', () => {
    expect(
      runRule('Accessibility', 'A11Y-004', loadFixtureContext('fx-A11Y-004-negative.html')),
    ).toEqual([]);
  });

  it('select и textarea без label — тоже findings (по одному на элемент)', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Bare controls page</title></head><body>' +
        '<form><select name="topic"><option>General</option></select>' +
        '<textarea name="message"></textarea></form></body></html>',
    );
    const findings = runRule('Accessibility', 'A11Y-004', ctx);
    expect(findings.map((finding) => finding.normalizedSelector).sort()).toEqual([
      'select[name="topic"]',
      'textarea[name="message"]',
    ]);
  });

  it('placeholder не заменяет label → finding остаётся', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Placeholder only page</title></head><body>' +
        '<form><input type="text" name="q" placeholder="Search" /></form></body></html>',
    );
    expect(single(runRule('Accessibility', 'A11Y-004', ctx)).normalizedSelector) //
      .toBe('input[name="q"]');
  });
});

describe('WCAG 2.2 AA static checks', () => {
  it('A11Y-001 finds an explicit low-contrast inline pair', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-001',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Contrast</title></head><body>' +
            '<main><h1 style="color:#777;background-color:#fff">Low contrast</h1></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('h1');
    expect(finding.evidenceExcerpt).toContain('4.48:1');
  });

  it('A11Y-001 does not claim a violation when the inline pair meets the threshold', () => {
    expect(
      runRule(
        'Accessibility',
        'A11Y-001',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Contrast</title></head><body>' +
            '<main><h1 style="color:#000;background-color:#fff">Readable</h1></main></body></html>',
        ),
      ),
    ).toEqual([]);
  });

  it('A11Y-003 reports missing language and skipped heading levels', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-003',
        htmlContext(
          '<!doctype html><html><head><title>Structure</title></head><body>' +
            '<main><h1>Page</h1><h3>Skipped</h3></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('html');
    expect(finding.evidenceExcerpt).toContain('html[lang]');
  });

  it('A11Y-005 reports positive tabindex and mouse-only handlers', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-005',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Keyboard</title></head><body>' +
            '<main><h1>Page</h1><div onclick="openPanel()">Open</div><a href="/next" tabindex="2">Next</a></main></body></html>',
        ),
      ),
    );
    expect(finding.evidenceExcerpt).toContain('tabindex > 0');
  });

  it('A11Y-006 reports focus outline removal without replacement', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-006',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Focus</title>' +
            '<style>button:focus { outline: none; }</style></head><body><main><h1>Page</h1></main></body></html>',
        ),
      ),
    );
    expect(finding.evidenceExcerpt).toContain(':focus rule');
  });

  it('A11Y-007 reports broken ARIA references and aria-hidden focusable controls', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-007',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>ARIA</title></head><body>' +
            '<main><h1>Page</h1><button aria-labelledby="missing">Open</button></main></body></html>',
        ),
      ),
    );
    expect(finding.evidenceExcerpt).toContain('aria-labelledby=missing');
  });

  // aria-hidden hides an element from screen readers but not from the Tab key.
  // The check for it could never fire: the focusability helper treated every
  // aria-hidden element as unfocusable before A11Y-007 asked about it.
  it.each([
    ['a link with href', '<a href="/next" aria-hidden="true">Next</a>', 'a'],
    [
      'an element with tabindex="0"',
      '<div id="panel" tabindex="0" aria-hidden="true"></div>',
      'div#panel',
    ],
    [
      'a native button',
      '<button name="close" aria-hidden="true">Close</button>',
      'button[name="close"]',
    ],
  ])('A11Y-007 reports %s that is aria-hidden yet keyboard-focusable', (_case, body, selector) => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-007',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>ARIA</title></head><body>' +
            `<main><h1>Page</h1>${body}</main></body></html>`,
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe(selector);
    expect(finding.messages?.evidence.code).toBe('a11y-007.evidence.hidden-focusable');
    expect(finding.evidenceExcerpt).toBe(
      `${selector} has aria-hidden="true" but is still in the tab order.`,
    );
  });

  // An aria-hidden element that the Tab key cannot reach is a legitimate
  // pattern (decorative icons, collapsed panels) and must not be reported.
  it.each([
    ['a decorative span', '<span aria-hidden="true">★</span>'],
    ['tabindex="-1"', '<button aria-hidden="true" tabindex="-1">Close</button>'],
    ['the hidden attribute', '<a href="/next" aria-hidden="true" hidden>Next</a>'],
    ['the inert attribute', '<button aria-hidden="true" inert>Close</button>'],
    ['inline display: none', '<a href="/next" aria-hidden="true" style="display: none">Next</a>'],
    [
      'inline visibility: hidden',
      '<button aria-hidden="true" style="visibility:hidden">Close</button>',
    ],
    ['a link without href', '<a aria-hidden="true">Next</a>'],
    ['a disabled button', '<button aria-hidden="true" disabled>Close</button>'],
    ['an input of type hidden', '<input type="hidden" name="token" aria-hidden="true" />'],
  ])(
    'A11Y-007 does not report an aria-hidden element the keyboard cannot reach: %s',
    (_case, body) => {
      expect(
        runRule(
          'Accessibility',
          'A11Y-007',
          htmlContext(
            '<!doctype html><html lang="en"><head><title>ARIA</title></head><body>' +
              `<main><h1>Page</h1>${body}</main></body></html>`,
          ),
        ),
      ).toEqual([]);
    },
  );

  it('A11Y-008 reports unnamed interactive elements', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-008',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Names</title></head><body>' +
            '<main><h1>Page</h1><button></button></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('button');
  });

  it('A11Y-009 requires an error description for an invalid control', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-009',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Errors</title></head><body>' +
            '<main><h1>Page</h1><input id="email" aria-invalid="true" /></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('input#email');
  });

  it('A11Y-010 reports missing main landmark and accepts an accessible document', () => {
    expect(
      runRule(
        'Accessibility',
        'A11Y-010',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Landmark</title></head><body>' +
            '<h1>Page</h1></body></html>',
        ),
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'Accessibility',
        'A11Y-010',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Landmark</title></head><body>' +
            '<main><h1>Page</h1></main></body></html>',
        ),
      ),
    ).toEqual([]);
  });

  it('A11Y-011 contributes a site report contract without an issue or penalty', () => {
    const result = runRule(
      'Accessibility',
      'A11Y-011',
      htmlContext(
        '<!doctype html><html lang="en"><head><title>Report</title></head><body>' +
          '<main><h1>Page</h1></main></body></html>',
      ),
    );
    expect(result).toEqual([]);
  });
});

// Отчёт читают на английском и украинском, поэтому каждый finding должен нести
// коды сообщений, а не готовый русский текст.
function pageWith(body: string, htmlAttributes = ' lang="en"'): SiteContext {
  return htmlContext(
    `<!doctype html><html${htmlAttributes}><head><title>Messages</title></head>` +
      `<body>${body}</body></html>`,
  );
}

const LOW_CONTRAST_BODY = '<main><h1 style="color:#777;background-color:#fff">Low</h1></main>';

interface MessageCase {
  readonly ruleId: string;
  readonly evidenceCode: string;
  readonly context: () => SiteContext;
}

const MESSAGE_CASES: readonly MessageCase[] = [
  {
    ruleId: 'A11Y-001',
    evidenceCode: 'a11y-001.evidence',
    context: () => pageWith(LOW_CONTRAST_BODY),
  },
  {
    ruleId: 'A11Y-002',
    evidenceCode: 'a11y-002.evidence',
    context: () => loadFixtureContext('fx-A11Y-002-positive.html'),
  },
  // Every combination of the three A11Y-003 problems: a wrong <h1> count must be
  // named as a problem whatever else is wrong on the page.
  {
    ruleId: 'A11Y-003',
    evidenceCode: 'a11y-003.evidence.missing-lang',
    context: () => pageWith('<main><h1>Page</h1></main>', ''),
  },
  {
    ruleId: 'A11Y-003',
    evidenceCode: 'a11y-003.evidence.h1-count',
    context: () => pageWith('<main><h2>No top heading</h2></main>'),
  },
  {
    ruleId: 'A11Y-003',
    evidenceCode: 'a11y-003.evidence.skipped-level',
    context: () => pageWith('<main><h1>Page</h1><h3>Skipped</h3></main>'),
  },
  {
    ruleId: 'A11Y-003',
    evidenceCode: 'a11y-003.evidence.missing-lang.h1-count',
    context: () => pageWith('<main><h2>No top heading</h2></main>', ''),
  },
  {
    ruleId: 'A11Y-003',
    evidenceCode: 'a11y-003.evidence.missing-lang.skipped-level',
    context: () => pageWith('<main><h1>Page</h1><h3>Skipped</h3></main>', ''),
  },
  {
    ruleId: 'A11Y-003',
    evidenceCode: 'a11y-003.evidence.h1-count.skipped-level',
    context: () => pageWith('<main><h1>One</h1><h1>Two</h1><h3>Skipped</h3></main>'),
  },
  {
    ruleId: 'A11Y-003',
    evidenceCode: 'a11y-003.evidence.missing-lang.h1-count.skipped-level',
    context: () => pageWith('<main><h1>One</h1><h1>Two</h1><h3>Skipped</h3></main>', ''),
  },
  {
    ruleId: 'A11Y-004',
    evidenceCode: 'a11y-004.evidence',
    context: () => loadFixtureContext('fx-A11Y-004-positive.html'),
  },
  {
    ruleId: 'A11Y-005',
    evidenceCode: 'a11y-005.evidence.positive-tabindex',
    context: () => pageWith('<main><a href="/next" tabindex="2">Next</a></main>'),
  },
  {
    ruleId: 'A11Y-005',
    evidenceCode: 'a11y-005.evidence.mouse-only',
    context: () => pageWith('<main><div onclick="openPanel()">Open</div></main>'),
  },
  {
    ruleId: 'A11Y-006',
    evidenceCode: 'a11y-006.evidence.stylesheet',
    context: () => pageWith('<style>button:focus { outline: none; }</style><main></main>'),
  },
  {
    ruleId: 'A11Y-006',
    evidenceCode: 'a11y-006.evidence.inline',
    context: () => pageWith('<main><button style="outline: none">Open</button></main>'),
  },
  {
    ruleId: 'A11Y-007',
    evidenceCode: 'a11y-007.evidence.unknown-role',
    context: () => pageWith('<main><div role="banana">Fruit</div></main>'),
  },
  {
    ruleId: 'A11Y-007',
    evidenceCode: 'a11y-007.evidence.missing-reference',
    context: () => pageWith('<main><button aria-labelledby="missing">Open</button></main>'),
  },
  {
    ruleId: 'A11Y-007',
    evidenceCode: 'a11y-007.evidence.hidden-focusable',
    context: () => pageWith('<main><a href="/next" aria-hidden="true">Next</a></main>'),
  },
  {
    ruleId: 'A11Y-008',
    evidenceCode: 'a11y-008.evidence.link-without-href',
    context: () => pageWith('<main><a>Read more</a></main>'),
  },
  {
    ruleId: 'A11Y-008',
    evidenceCode: 'a11y-008.evidence.missing-name',
    context: () => pageWith('<main><button></button></main>'),
  },
  {
    ruleId: 'A11Y-009',
    evidenceCode: 'a11y-009.evidence',
    context: () => pageWith('<main><input id="email" aria-invalid="true" /></main>'),
  },
  {
    ruleId: 'A11Y-010',
    evidenceCode: 'a11y-010.evidence.missing-main',
    context: () => pageWith('<h1>Page</h1>'),
  },
  {
    ruleId: 'A11Y-010',
    evidenceCode: 'a11y-010.evidence.multiple-main',
    context: () => pageWith('<main></main><main></main>'),
  },
  {
    ruleId: 'A11Y-010',
    evidenceCode: 'a11y-010.evidence.untitled-iframe',
    context: () => pageWith('<main><iframe src="/embed"></iframe></main>'),
  },
  {
    ruleId: 'A11Y-010',
    evidenceCode: 'a11y-010.evidence.video-without-captions',
    context: () => pageWith('<main><video src="/intro.mp4"></video></main>'),
  },
  {
    ruleId: 'A11Y-010',
    evidenceCode: 'a11y-010.evidence.unnamed-nav',
    context: () => pageWith('<main></main><nav></nav><nav></nav>'),
  },
];

describe('Accessibility finding messages', () => {
  it.each(MESSAGE_CASES)('$ruleId → $evidenceCode', ({ ruleId, evidenceCode, context }) => {
    const finding = single(runRule('Accessibility', ruleId, context()));
    const messages = finding.messages;
    expect(messages?.evidence.code).toBe(evidenceCode);
    expect(messages?.recommendation.code).toBe(`${ruleId.toLowerCase()}.recommendation`);
    expect(finding.evidenceExcerpt).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(finding.recommendation).not.toMatch(/\p{Script=Cyrillic}/u);
    if (messages !== undefined) {
      expect(renderFindingMessage(messages.evidence, 'uk')).not.toBeNull();
      expect(renderFindingMessage(messages.recommendation, 'uk')).not.toBeNull();
    }
  });

  it('A11Y-001 stores the ratio and threshold as data and renders them in English', () => {
    const finding = single(runRule('Accessibility', 'A11Y-001', pageWith(LOW_CONTRAST_BODY)));
    expect(finding.messages?.evidence.params).toEqual({
      selector: 'h1',
      ratio: '4.48',
      threshold: '4.5',
    });
    expect(finding.evidenceExcerpt).toBe(
      'h1 sets inline color/background-color with a contrast ratio of 4.48:1, below the 4.5:1 threshold.',
    );
  });
});
