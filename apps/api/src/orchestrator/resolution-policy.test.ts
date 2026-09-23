// Resolved назначается только там, где прогон доказал повторную проверку.
// Каждый тест ниже — реальный способ солгать владельцу «мы это починили».

import { scanScopeSchema } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { provesRepeatCheck, resolvableIssues } from './resolution-policy.ts';
import type { PreviousIssueTarget, PreviousRunCoverage, RunCoverage } from './resolution-policy.ts';
import { crawlRequestContext, type RunRequestContext } from './run-context.ts';
import type { RuleCoverageIndex } from './run-coverage.ts';

const RULESET = 'rules-mvp-0.1';
const HOME = 'https://example.com/';
const SHOP_ITEM = 'https://example.com/shop/item';
const BLOG_POST = 'https://example.com/blog/post';
const GONE = 'https://example.com/gone.html';
const SITEMAP = 'sitemap:read';

/** Контекст обхода всего сайта — тот же, что пишет run-attempt (run-context.ts). */
const DESKTOP: RunRequestContext = crawlRequestContext(
  scanScopeSchema.parse({ includeSubdomains: false }),
);

/** Тот же запрос, суженный шаблоном: /shop/* обходу больше не разрешён. */
const WITHOUT_SHOP: RunRequestContext = crawlRequestContext(
  scanScopeSchema.parse({ includeSubdomains: false, excludePatterns: ['/shop/*'] }),
);

interface CoverageOptions {
  /** ruleId → входы правила за пределами его целей, на которые получен ответ. */
  readonly inputs?: Readonly<Record<string, readonly string[]>>;
  /** ruleId → спрос правила; не задан — правило спрос не объявляло. */
  readonly requested?: Readonly<Record<string, readonly string[]>>;
  readonly context?: RunRequestContext;
}

/** ruleId → цели, которые правило прочитало. */
function checked(
  entries: Readonly<Record<string, readonly string[]>>,
  options: CoverageOptions = {},
): RuleCoverageIndex {
  return new Map(
    Object.entries(entries).map(([ruleId, targets]) => {
      const requested = options.requested?.[ruleId];
      return [
        ruleId,
        {
          checkedTargets: new Set(targets),
          inputTargets: new Set(options.inputs?.[ruleId] ?? []),
          requestedInputs: requested === undefined ? null : new Set(requested),
          context: options.context ?? DESKTOP,
        },
      ];
    }),
  );
}

function issue(overrides: Partial<PreviousIssueTarget> = {}): PreviousIssueTarget {
  return {
    id: 'issue-1',
    fingerprint: 'fp-1',
    ruleId: 'SEO-TECH-004',
    module: 'SEO',
    targetKind: 'page',
    normalizedUrl: SHOP_ITEM,
    ...overrides,
  };
}

function run(overrides: Partial<RunCoverage> = {}): RunCoverage {
  return {
    coverageByRule: checked({ 'SEO-TECH-004': [SHOP_ITEM] }),
    completedModules: new Set(['SEO']),
    rulesetVersion: RULESET,
    ...overrides,
  };
}

function previous(overrides: Partial<PreviousRunCoverage> = {}): PreviousRunCoverage {
  return {
    coverageByRule: checked({ 'SEO-TECH-004': [SHOP_ITEM] }),
    issueDependencies: new Map(),
    rulesetVersion: RULESET,
    ...overrides,
  };
}

describe('page-level findings', () => {
  it('закрывает находку, которую то же правило перепроверило на той же странице', () => {
    expect(provesRepeatCheck(issue(), run(), previous())).toBe(true);
    expect(
      resolvableIssues([issue()], new Set(), run(), previous()).map((entry) => entry.id),
    ).toEqual(['issue-1']);
  });

  it('вернувшийся fingerprint не закрывается — он всё ещё найден', () => {
    expect(resolvableIssues([issue()], new Set(['fp-1']), run(), previous())).toEqual([]);
  });

  it('скан, суженный до /blog/*, не закрывает находки на /shop/*', () => {
    const blogOnly = run({ coverageByRule: checked({ 'SEO-TECH-004': [BLOG_POST] }) });
    expect(provesRepeatCheck(issue(), blogOnly, previous())).toBe(false);
    expect(resolvableIssues([issue()], new Set(), blogOnly, previous())).toEqual([]);
  });

  it('страница за лимитом URL или под robots.txt не считается проверенной', () => {
    const nothingChecked = run({ coverageByRule: checked({ 'SEO-TECH-004': [] }) });
    expect(provesRepeatCheck(issue(), nothingChecked, previous())).toBe(false);
  });

  it('страница, отдавшая 404 или PDF, не закрывает DOM-находку на ней', () => {
    // Обход её загрузил, но page-правило работает только по успешному HTML:
    // в checkedTargets правила её нет, и исчезновение находки не значит починки —
    // страница просто умерла.
    const pageDied = run({ coverageByRule: checked({ 'SEO-TECH-004': [HOME] }) });
    expect(provesRepeatCheck(issue(), pageDied, previous())).toBe(false);
  });

  it('проверку доказывает именно своё правило, а не сосед по модулю', () => {
    // Другое правило того же модуля видело страницу — про это правило это
    // ничего не говорит (например, его цель стала неприменимой).
    const otherRuleOnly = run({
      coverageByRule: checked({ 'SEO-TECH-003': [SHOP_ITEM] }),
    });
    expect(provesRepeatCheck(issue(), otherRuleOnly, previous())).toBe(false);
  });

  it('скан без записанного покрытия не закрывает даже page-находку', () => {
    // Скан старше этой политики: сравнить не с чем — ни входы, ни конфигурацию
    // запроса. «Не знаю» оставляет находку открытой.
    const unknownPast = previous({ coverageByRule: checked({}) });
    expect(provesRepeatCheck(issue(), run(), unknownPast)).toBe(false);
  });
});

describe('входы page-правил (зависимость от чужих снимков)', () => {
  // SEO-TECH-006 судит страницу-ИСТОЧНИК ссылки, а вердикт берёт из снимка её
  // ЦЕЛИ. Пропавшая из обхода цель убирает находку, ничего не починив.
  const brokenLink = issue({
    id: 'issue-link',
    fingerprint: 'fp-link',
    ruleId: 'SEO-TECH-006',
    normalizedUrl: HOME,
  });

  const before = previous({
    coverageByRule: checked(
      { 'SEO-TECH-006': [HOME] },
      { inputs: { 'SEO-TECH-006': [HOME, GONE] } },
    ),
  });

  it('обход, потерявший цель ссылки, не закрывает находку о битой ссылке', () => {
    const lostTarget = run({
      coverageByRule: checked({ 'SEO-TECH-006': [HOME] }, { inputs: { 'SEO-TECH-006': [HOME] } }),
    });
    expect(provesRepeatCheck(brokenLink, lostTarget, before)).toBe(false);
  });

  it('обход, снова увидевший цель ссылки, закрывает её', () => {
    const sawTarget = run({
      coverageByRule: checked(
        { 'SEO-TECH-006': [HOME] },
        { inputs: { 'SEO-TECH-006': [HOME, GONE, BLOG_POST] } },
      ),
    });
    expect(provesRepeatCheck(brokenLink, sawTarget, before)).toBe(true);
  });

  it('то же для CONTENT-004: снимок media — вход, а не цель', () => {
    const media = 'https://example.com/img/x.png';
    const brokenMedia = issue({
      id: 'issue-media',
      fingerprint: 'fp-media',
      ruleId: 'CONTENT-004',
      module: 'Content',
      normalizedUrl: HOME,
    });
    const mediaBefore = previous({
      coverageByRule: checked(
        { 'CONTENT-004': [HOME] },
        { inputs: { 'CONTENT-004': [HOME, media] } },
      ),
    });
    const withoutMedia = run({
      coverageByRule: checked({ 'CONTENT-004': [HOME] }, { inputs: { 'CONTENT-004': [HOME] } }),
      completedModules: new Set(['Content']),
    });
    expect(provesRepeatCheck(brokenMedia, withoutMedia, mediaBefore)).toBe(false);
  });

  it('правило без собственных входов закрывается по одной своей цели', () => {
    // Пустой список входов — не пробел в доказательстве: вердикт SEO-TECH-004
    // целиком следует из снимка самой страницы.
    expect(provesRepeatCheck(issue(), run(), previous())).toBe(true);
  });
});

describe('спрос правила: снятая зависимость против потерянной', () => {
  // Четыре прогона из отчёта ревью. Находка одна: на главной битая ссылка на
  // /gone.html. Разница только в том, что стало со ссылкой и с её целью.
  const OTHER = 'https://example.com/old.html';
  const brokenLink = issue({
    id: 'issue-link',
    fingerprint: 'fp-link',
    ruleId: 'SEO-TECH-006',
    normalizedUrl: HOME,
  });
  const before = previous({
    coverageByRule: checked(
      { 'SEO-TECH-006': [HOME] },
      {
        inputs: { 'SEO-TECH-006': [HOME, GONE, OTHER] },
        requested: { 'SEO-TECH-006': [HOME, GONE, OTHER] },
      },
    ),
    // Находка держалась ровно на одном снимке — статусе цели ссылки.
    issueDependencies: new Map([['fp-link', [GONE]]]),
  });

  function linkRun(
    inputs: readonly string[],
    requested: readonly string[] | undefined,
  ): RunCoverage {
    return run({
      coverageByRule: checked(
        { 'SEO-TECH-006': [HOME] },
        {
          inputs: { 'SEO-TECH-006': inputs },
          ...(requested === undefined ? {} : { requested: { 'SEO-TECH-006': requested } }),
        },
      ),
    });
  }

  it('A: владелец удалил битую ссылку — это починка, и находка закрывается', () => {
    // Цель больше не отвечена, но о ней больше и не спрашивают: со страниц
    // сайта ссылка исчезла. Прежняя версия политики оставляла такую находку
    // New навсегда — ровно на том действии, которое сама и рекомендовала.
    expect(provesRepeatCheck(brokenLink, linkRun([HOME, OTHER], [HOME, OTHER]), before)).toBe(true);
  });

  it('B: цель починена и снова отвечает — находка закрывается', () => {
    expect(
      provesRepeatCheck(brokenLink, linkRun([HOME, GONE, OTHER], [HOME, GONE, OTHER]), before),
    ).toBe(true);
  });

  it('C: починенная цель закрывается, даже если из обхода ушла НЕСВЯЗАННАЯ страница', () => {
    // /old.html удалена и ниоткуда не упоминается. К этой находке она не имеет
    // отношения, и раньше именно такое «сужение» замораживало все находки
    // правила по всему сайту.
    expect(provesRepeatCheck(brokenLink, linkRun([HOME, GONE], [HOME, GONE]), before)).toBe(true);
  });

  it('D: ссылка на месте, а цель не обойдена — это неизвестность, находка остаётся', () => {
    expect(provesRepeatCheck(brokenLink, linkRun([HOME, OTHER], [HOME, GONE, OTHER]), before)).toBe(
      false,
    );
  });

  it('правило, не объявившее спрос, не может признать вход снятым', () => {
    // undefined requested — нет доказательства, что ссылки больше нет; тогда
    // недостающий вход оставляет находку открытой (поведение до этого фикса).
    expect(provesRepeatCheck(brokenLink, linkRun([HOME, OTHER], undefined), before)).toBe(false);
  });

  it('находка без записанных зависимостей требует повторить входы правила целиком', () => {
    // Скан, записавший покрытие правила, но не материал этой находки (старая
    // запись): требование — весь прошлый список входов.
    const withoutIssueProof = previous({
      coverageByRule: before.coverageByRule,
      issueDependencies: new Map(),
    });
    // Ссылка на /old.html осталась, а снимка по ней в этом прогоне нет. К
    // находке о /gone.html это отношения не имеет — и с записью о ней она
    // закрывается; без записи правило судится целиком и остаётся открытым.
    const lostUnrelated = linkRun([HOME, GONE], [HOME, GONE, OTHER]);
    expect(provesRepeatCheck(brokenLink, lostUnrelated, withoutIssueProof)).toBe(false);
    expect(provesRepeatCheck(brokenLink, lostUnrelated, before)).toBe(true);
    expect(
      provesRepeatCheck(
        brokenLink,
        linkRun([HOME, GONE, OTHER], [HOME, GONE, OTHER]),
        withoutIssueProof,
      ),
    ).toBe(true);
  });

  it('CONTENT-004: снятая картинка закрывается, необойдённая — нет', () => {
    const media = 'https://example.com/img/x.png';
    const brokenMedia = issue({
      id: 'issue-media',
      fingerprint: 'fp-media',
      ruleId: 'CONTENT-004',
      module: 'Content',
      normalizedUrl: HOME,
    });
    const mediaBefore = previous({
      coverageByRule: checked(
        { 'CONTENT-004': [HOME] },
        { inputs: { 'CONTENT-004': [HOME, media] }, requested: { 'CONTENT-004': [HOME, media] } },
      ),
      issueDependencies: new Map([['fp-media', [media]]]),
    });
    const mediaRun = (requested: readonly string[]): RunCoverage =>
      run({
        coverageByRule: checked(
          { 'CONTENT-004': [HOME] },
          { inputs: { 'CONTENT-004': [HOME] }, requested: { 'CONTENT-004': requested } },
        ),
        completedModules: new Set(['Content']),
      });
    // Картинки на странице больше нет → закрываем.
    expect(provesRepeatCheck(brokenMedia, mediaRun([HOME]), mediaBefore)).toBe(true);
    // Картинка на месте, но снимка по ней в этом прогоне нет → не знаем.
    expect(provesRepeatCheck(brokenMedia, mediaRun([HOME, media]), mediaBefore)).toBe(false);
  });
});

describe('конфигурация запроса', () => {
  it('mobile-прогон не закрывает находку desktop-прогона', () => {
    const mobile = run({
      coverageByRule: checked(
        { 'SEO-TECH-004': [SHOP_ITEM] },
        { context: { ...DESKTOP, userAgent: 'mobile' } },
      ),
    });
    expect(provesRepeatCheck(issue(), mobile, previous())).toBe(false);
  });

  it('перепривязка GA4 к другому property не закрывает находки прошлого property', () => {
    const analyticsIssue = issue({
      id: 'issue-ga',
      fingerprint: 'fp-ga',
      ruleId: 'ANALYTICS-GA-001',
      module: 'Analytics',
      targetKind: 'site',
      normalizedUrl: '',
    });
    const boundTo = (propertyId: string): RuleCoverageIndex =>
      checked(
        { 'ANALYTICS-GA-001': [HOME] },
        { context: { ...DESKTOP, ga4PropertyId: propertyId } },
      );
    const rebound = run({
      coverageByRule: boundTo('222'),
      completedModules: new Set(['Analytics']),
    });
    expect(
      provesRepeatCheck(analyticsIssue, rebound, previous({ coverageByRule: boundTo('111') })),
    ).toBe(false);
    expect(
      provesRepeatCheck(
        analyticsIssue,
        run({ coverageByRule: boundTo('111'), completedModules: new Set(['Analytics']) }),
        previous({ coverageByRule: boundTo('111') }),
      ),
    ).toBe(true);
  });
});

describe('сузившийся scope обхода', () => {
  // URL, отброшенный фильтром scope, исчезает из обхода бесследно: краулер
  // отбрасывает его до записи вариантов и не кладёт ни в skippedOverLimit, ни в
  // blockedByRobots, ни в errors. Для правил, чей спрос — это множество
  // увиденных URL, такая страница выглядит удалённой с сайта, то есть
  // починенной. Контрольный прогон в каждом тесте — та же пропавшая страница
  // при ТОМ ЖЕ scope (лимит URL): он отличает фильтр от потери данных.
  it('scope и user-agent — независимые части контекста', () => {
    expect(WITHOUT_SHOP.userAgent).toBe(DESKTOP.userAgent);
    expect(WITHOUT_SHOP.crawlScope).not.toBe(DESKTOP.crawlScope);
  });

  const duplicateUrlsIssue = issue({
    id: 'issue-dup',
    fingerprint: 'fp-dup',
    ruleId: 'SEO-TECH-007',
    targetKind: 'site',
    normalizedUrl: '',
  });
  const dupBefore = previous({
    coverageByRule: checked(
      { 'SEO-TECH-007': [HOME, SHOP_ITEM] },
      { requested: { 'SEO-TECH-007': [HOME, SHOP_ITEM] } },
    ),
  });

  function dupRun(requested: readonly string[], context: RunRequestContext): RunCoverage {
    return run({
      coverageByRule: checked(
        { 'SEO-TECH-007': [HOME] },
        { requested: { 'SEO-TECH-007': requested }, context },
      ),
    });
  }

  it('site-правило: исключённая шаблоном страница не закрывает находку о дублях', () => {
    expect(provesRepeatCheck(duplicateUrlsIssue, dupRun([HOME], WITHOUT_SHOP), dupBefore)).toBe(
      false,
    );
  });

  it('контроль: та же страница за лимитом URL при том же scope — тоже не закрывает', () => {
    expect(
      provesRepeatCheck(duplicateUrlsIssue, dupRun([HOME, SHOP_ITEM], DESKTOP), dupBefore),
    ).toBe(false);
  });

  it('контроль: при том же scope реально удалённая страница находку закрывает', () => {
    expect(provesRepeatCheck(duplicateUrlsIssue, dupRun([HOME], DESKTOP), dupBefore)).toBe(true);
  });

  // SEO-TECH-008: противоречие noindex на главной создают ссылки ДРУГИХ
  // страниц, поэтому его находка зависит от их снимков и от прочитанного
  // sitemap.
  const noindexIssue = issue({
    id: 'issue-noindex',
    fingerprint: 'fp-noindex',
    ruleId: 'SEO-TECH-008',
    normalizedUrl: HOME,
  });
  const noindexBefore = previous({
    coverageByRule: checked(
      { 'SEO-TECH-008': [HOME] },
      {
        inputs: { 'SEO-TECH-008': [HOME, SHOP_ITEM, SITEMAP] },
        requested: { 'SEO-TECH-008': [HOME, SHOP_ITEM, SITEMAP] },
      },
    ),
    issueDependencies: new Map([['fp-noindex', [HOME, SHOP_ITEM, SITEMAP]]]),
  });

  function noindexRun(requested: readonly string[], context: RunRequestContext): RunCoverage {
    return run({
      coverageByRule: checked(
        { 'SEO-TECH-008': [HOME] },
        {
          inputs: { 'SEO-TECH-008': [HOME, SITEMAP] },
          requested: { 'SEO-TECH-008': requested },
          context,
        },
      ),
    });
  }

  it('page-правило: исключённая шаблоном страница-источник не закрывает находку', () => {
    expect(
      provesRepeatCheck(noindexIssue, noindexRun([HOME, SITEMAP], WITHOUT_SHOP), noindexBefore),
    ).toBe(false);
  });

  it('контроль: страница-источник за лимитом URL при том же scope — не закрывает', () => {
    expect(
      provesRepeatCheck(
        noindexIssue,
        noindexRun([HOME, SHOP_ITEM, SITEMAP], DESKTOP),
        noindexBefore,
      ),
    ).toBe(false);
  });

  it('контроль: при том же scope удалённая страница-источник находку закрывает', () => {
    expect(
      provesRepeatCheck(noindexIssue, noindexRun([HOME, SITEMAP], DESKTOP), noindexBefore),
    ).toBe(true);
  });

  it('другой scope не закрывает и находку правила без собственного спроса', () => {
    // Гасится сравнение целиком, а не только вывод «вход сняли»: под другими
    // фильтрами обхода совпадение целей уже ничего не значит.
    const narrowed = run({
      coverageByRule: checked({ 'SEO-TECH-004': [SHOP_ITEM] }, { context: WITHOUT_SHOP }),
    });
    expect(provesRepeatCheck(issue(), narrowed, previous())).toBe(false);
  });
});

describe('модуль и ruleset', () => {
  it('отключённая Analytics не закрывает прошлые находки Analytics', () => {
    const analyticsIssue = issue({
      id: 'issue-analytics',
      fingerprint: 'fp-analytics',
      ruleId: 'ANALYTICS-GA-002',
      module: 'Analytics',
      normalizedUrl: HOME,
    });
    const analyticsCoverage = checked({ 'ANALYTICS-GA-002': [HOME] });
    const analyticsBefore = previous({ coverageByRule: analyticsCoverage });
    // Модуль в прогоне есть, но Unavailable → в completedModules не попал.
    expect(
      provesRepeatCheck(
        analyticsIssue,
        run({ coverageByRule: analyticsCoverage }),
        analyticsBefore,
      ),
    ).toBe(false);
    expect(
      provesRepeatCheck(
        analyticsIssue,
        run({
          coverageByRule: analyticsCoverage,
          completedModules: new Set(['SEO', 'Analytics']),
        }),
        analyticsBefore,
      ),
    ).toBe(true);
  });

  it('модуль, упавший или отработавший частично, ничего не закрывает', () => {
    expect(provesRepeatCheck(issue(), run({ completedModules: new Set() }), previous())).toBe(
      false,
    );
  });

  it('смена ruleset запрещает закрытие: правило могло измениться или исчезнуть', () => {
    const newRuleset = previous({ rulesetVersion: 'rules-mvp-0.2' });
    expect(provesRepeatCheck(issue(), run(), newRuleset)).toBe(false);
    expect(resolvableIssues([issue()], new Set(), run(), newRuleset)).toEqual([]);
  });
});

describe('site-level находки', () => {
  const privacyIssue = issue({
    id: 'issue-privacy',
    fingerprint: 'fp-privacy',
    ruleId: 'PRIVACY-004',
    module: 'Privacy',
    targetKind: 'site',
    // D-019: у site-находки нет URL в fingerprint, поэтому по нему проверять нечего.
    normalizedUrl: '',
  });

  function privacyRun(homepage: readonly string[]): RunCoverage {
    return run({
      coverageByRule: checked({ 'PRIVACY-004': homepage }),
      completedModules: new Set(['Privacy']),
    });
  }

  it('обход без главной не закрывает находку о ссылке на политику', () => {
    // Модуль Privacy завершился на остальных правилах, а PRIVACY-004 главную не
    // видел: applicableTargets у него 0, и доказательства нет.
    const before = previous({ coverageByRule: checked({ 'PRIVACY-004': [HOME] }) });
    expect(provesRepeatCheck(privacyIssue, privacyRun([]), before)).toBe(false);
  });

  it('обход с главной закрывает её — остальные страницы к делу не относятся', () => {
    const before = previous({ coverageByRule: checked({ 'PRIVACY-004': [HOME] }) });
    expect(provesRepeatCheck(privacyIssue, privacyRun([HOME]), before)).toBe(true);
  });

  it('неизвестное покрытие прошлого скана оставляет site-находку открытой', () => {
    // Скан старше этой политики (или с повреждённой метадатой): сравнить входы
    // не с чем, и закрывать нельзя.
    expect(provesRepeatCheck(privacyIssue, privacyRun([HOME]), previous())).toBe(false);
  });

  const duplicateUrlsIssue = issue({
    id: 'issue-dup',
    fingerprint: 'fp-dup',
    ruleId: 'SEO-TECH-007',
    module: 'SEO',
    targetKind: 'site',
    normalizedUrl: '',
  });

  it('суженный обход не закрывает находку о дублях URL', () => {
    // SEO-TECH-007 всегда applicable (applicableTargets = 1), поэтому доказать
    // повторную проверку может только то, что обход прочитал те же страницы:
    // варианты URL берутся из ссылок на них. Спрос здесь настоящий — тот, что
    // вернёт discoveredTargets суженного обхода: отфильтрованный scope-ом URL
    // не попадает ни в pages, ни в skippedOverLimit, ни в blockedByRobots, и
    // «страницы не видно» становится неотличимо от «страницы больше нет».
    // Защищает от этого контекст запроса: scope у прогонов разный.
    const before = previous({
      coverageByRule: checked({ 'SEO-TECH-007': [HOME, SHOP_ITEM, BLOG_POST] }),
    });
    const narrowed = run({
      coverageByRule: checked(
        { 'SEO-TECH-007': [HOME, BLOG_POST] },
        {
          requested: { 'SEO-TECH-007': [HOME, BLOG_POST] },
          context: WITHOUT_SHOP,
        },
      ),
    });
    expect(provesRepeatCheck(duplicateUrlsIssue, narrowed, before)).toBe(false);
  });

  it('обход тех же (или большего числа) страниц закрывает её', () => {
    const before = previous({
      coverageByRule: checked({ 'SEO-TECH-007': [HOME, SHOP_ITEM] }),
    });
    const wider = run({
      coverageByRule: checked({ 'SEO-TECH-007': [HOME, SHOP_ITEM, BLOG_POST] }),
    });
    expect(provesRepeatCheck(duplicateUrlsIssue, wider, before)).toBe(true);
  });

  it('удалённая страница не замораживает находку о дублях навсегда', () => {
    // Владелец удалил /blog/post и убрал ссылки на него: обход его больше не
    // видит нигде. Прошлый набор страниц повторить невозможно в принципе, и
    // требование «повтори всё» оставляло бы находку New до конца времён.
    const before = previous({
      coverageByRule: checked({ 'SEO-TECH-007': [HOME, SHOP_ITEM, BLOG_POST] }),
    });
    const deleted = run({
      coverageByRule: checked(
        { 'SEO-TECH-007': [HOME, SHOP_ITEM] },
        { requested: { 'SEO-TECH-007': [HOME, SHOP_ITEM] } },
      ),
    });
    expect(provesRepeatCheck(duplicateUrlsIssue, deleted, before)).toBe(true);
  });

  it('страница, которую обход ВИДИТ, но не прочитал, находку не закрывает', () => {
    // Ссылки на неё остались (она в спросе), а снимка нет: лимит URL, robots
    // или ошибка — данные потеряны, а не исправлены.
    const before = previous({
      coverageByRule: checked({ 'SEO-TECH-007': [HOME, SHOP_ITEM, BLOG_POST] }),
    });
    const lost = run({
      coverageByRule: checked(
        { 'SEO-TECH-007': [HOME, SHOP_ITEM] },
        { requested: { 'SEO-TECH-007': [HOME, SHOP_ITEM, BLOG_POST] } },
      ),
    });
    expect(provesRepeatCheck(duplicateUrlsIssue, lost, before)).toBe(false);
  });
});

describe('api-находки', () => {
  const apiIssue = issue({
    id: 'issue-api',
    fingerprint: 'fp-api',
    ruleId: 'REL-API-003',
    module: 'Reliability',
    targetKind: 'api',
    normalizedUrl: 'https://example.com/api/health',
  });
  const apiBefore = previous({
    coverageByRule: checked({ 'REL-API-003': ['https://example.com/api/health'] }),
  });

  it('загруженная обходом страница по тому же URL ничего не доказывает', () => {
    // API-проверки (§9) выполняются отдельно от обхода: их у прогона может не
    // быть вовсе, а страница по тому же адресу — другая проверка.
    const crawlOnly = run({
      coverageByRule: checked({ 'SEO-TECH-004': ['https://example.com/api/health'] }),
      completedModules: new Set(['SEO', 'Reliability']),
    });
    expect(provesRepeatCheck(apiIssue, crawlOnly, apiBefore)).toBe(false);
  });

  it('выполненная проверка этого endpoint-а закрывает находку', () => {
    const apiRun = run({
      coverageByRule: checked({ 'REL-API-003': ['https://example.com/api/health'] }),
      completedModules: new Set(['Reliability']),
    });
    expect(provesRepeatCheck(apiIssue, apiRun, apiBefore)).toBe(true);
  });
});

describe('смешанный набор', () => {
  it('закрывается только доказанная часть', () => {
    const checkedIssue = issue({ id: 'checked', fingerprint: 'fp-checked' });
    const uncheckedIssue = issue({
      id: 'unchecked',
      fingerprint: 'fp-unchecked',
      normalizedUrl: 'https://example.com/shop/other',
    });
    const otherModule = issue({
      id: 'other-module',
      fingerprint: 'fp-other-module',
      module: 'Privacy',
    });
    expect(
      resolvableIssues(
        [checkedIssue, uncheckedIssue, otherModule],
        new Set(),
        run(),
        previous(),
      ).map((entry) => entry.id),
    ).toEqual(['checked']);
  });
});
