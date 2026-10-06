// The public example report (/example-report) — whether the report it shows is true of the product.
//
// It exists for a stranger: somebody weighing up the product who cannot see a
// report because they have not bought one. The suite was one 1,125-line file
// and is five now, one per question it answers; the helpers they share live in
// `example-report-test-support.tsx`.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { exampleReportCopy } from './example-report-copy';
import {
  EXAMPLE_DASHBOARD,
  EXAMPLE_DOMAIN,
  EXAMPLE_ISSUES,
  EXAMPLE_RULE_IDS,
  EXAMPLE_SUMMARY,
} from './example-report-fixture';
import {
  SCORING_SOURCE,
  cleanupExamplePage,
  openExample,
  unfoldEveryProblem,
} from './example-report-test-support';
import { hasFindingExplainer, problemTitle } from './finding-explainers';
import { findingsCopy } from './findings-copy';
import { copy } from './i18n';
import { PLAN_MODULES, PLAN_URL_LIMIT, SIDE_SCORE_MODULES } from './plan-modules';

afterEach(cleanupExamplePage);

describe('the report it shows is truthful about the product', () => {
  it('reports only on rules the product really has, each with a plain name', () => {
    expect(EXAMPLE_RULE_IDS.length).toBeGreaterThanOrEqual(5);
    for (const ruleId of EXAMPLE_RULE_IDS) {
      // In the registry, and explained in plain language — the two conditions
      // that make a finding readable to the owner this page is written for.
      expect(hasFindingExplainer(ruleId)).toBe(true);
      for (const language of ['en', 'uk'] as const) {
        const title = problemTitle(ruleId, language);
        expect(title).not.toBe(ruleId);
        expect(title.length).toBeGreaterThan(8);
      }
    }
  });

  it('keeps the fixture consistent with itself', () => {
    // The summary and the findings are two views of one invented site; a
    // mismatch would be a report that contradicts its own list.
    expect(EXAMPLE_SUMMARY.groups.map((group) => group.ruleId)).toEqual([...EXAMPLE_RULE_IDS]);
    expect([...new Set(EXAMPLE_ISSUES.map((issue) => issue.ruleId))]).toEqual([
      ...EXAMPLE_RULE_IDS,
    ]);
    // One finding per address, so every count the report prints is counted
    // rather than asserted — the card, the summary and the copied message read
    // the same number off the same list.
    for (const group of EXAMPLE_SUMMARY.groups) {
      const findings = EXAMPLE_ISSUES.filter((issue) => issue.ruleId === group.ruleId);
      expect(findings).toHaveLength(group.openIssues);
      expect(new Set(findings.map((issue) => issue.targetUrl)).size).toBe(findings.length);
    }
    expect(EXAMPLE_SUMMARY.open).toBe(
      EXAMPLE_SUMMARY.groups.reduce((sum, group) => sum + group.openIssues, 0),
    );
    // A score, and a "checks done" figure that is not a flat 100%: the example
    // has to show the shape of an honest report, the one section that did not
    // finish included. The *crawl* is complete, which is a different figure and
    // the point of the sentence beside it.
    expect(EXAMPLE_DASHBOARD.overall.score).not.toBeNull();
    expect(EXAMPLE_DASHBOARD.overall.weightedCoverage).toBeLessThan(1);
    expect(EXAMPLE_DASHBOARD.scan.crawlSummary?.pagesRead).toBe(
      EXAMPLE_DASHBOARD.scan.crawlSummary?.urlsDiscovered,
    );
    // A section with a reason is a section that did not close every check, so
    // it is Partial — §15/§16 forbid a Completed row from carrying a reason —
    // and the scan row follows it, as `resolveScanOutcome` makes it follow.
    for (const module of EXAMPLE_DASHBOARD.modules) {
      const closed = module.completedApplicableChecks === module.applicableChecks;
      expect({ module: module.module, status: module.status }).toEqual({
        module: module.module,
        status: closed ? 'Completed' : 'Partial',
      });
      expect(module.statusReason === null).toBe(closed);
      expect(module.coverage).toBeCloseTo(
        (module.completedApplicableChecks ?? 0) / (module.applicableChecks ?? 1),
        12,
      );
    }
    const unfinished = EXAMPLE_DASHBOARD.modules.filter((module) => module.status !== 'Completed');
    expect(unfinished).toHaveLength(1);
    expect(EXAMPLE_DASHBOARD.scan.status).toBe('Partial');
    // One finding per address, and every rule applicable to every address the
    // crawl read: the literal 12 beside a `pagesRead` of 12 was one fact twice.
    for (const issue of EXAMPLE_ISSUES) {
      expect(issue.applicableTargets).toBe(EXAMPLE_DASHBOARD.scan.crawlSummary?.pagesRead);
    }
  });

  // The headline numbers were typed in by hand and disagreed with the cards
  // under them: 68.4 over six sections whose lowest mean is 75, and a coverage
  // of 0.94 over module coverages averaging 0.97. They are computed from the
  // sections now, the way `packages/scoring/src/overall-score.ts` computes
  // them, and this recomputes them from the rows the page actually draws.
  it('reads its score and its coverage off the sections that count towards them', () => {
    const { modules, overall } = EXAMPLE_DASHBOARD;
    const sum = (values: readonly number[]): number =>
      values.reduce((total, value) => total + value, 0);
    // §15 leaves the side scores out of the overall number — `overall-score.ts`
    // skips every module in `SIDE_SCORE_MODULES` — and the fixture averaged
    // UX/Conversion's 58 into it. The list is read from the mirror of the
    // tariff table rather than written here, so this cannot encode the mistake
    // a second time.
    const counted = modules.filter((module) => !SIDE_SCORE_MODULES.includes(module.module));
    expect(counted.length).toBeLessThan(modules.length);
    const earned = counted.map((module) => module.coverage ?? 0);

    // Coverage: the share of the counting sections' weight the run earned.
    expect(overall.weightedCoverage).toBeCloseTo(sum(earned) / counted.length, 12);
    // Score: those section scores averaged by that same earned weight, to two
    // places — the number the dial prints.
    const scored = counted.filter((module) => module.score !== null && (module.coverage ?? 0) > 0);
    const weighted = sum(scored.map((module) => (module.score ?? 0) * (module.coverage ?? 0)));
    const expected = Math.round((weighted / sum(scored.map((m) => m.coverage ?? 0))) * 100) / 100;
    expect(overall.score).toBe(expected);
    // And the weights the dashboard carries name only those sections, the way
    // the API's own `buildModuleWeights` does.
    expect(overall.moduleWeights?.map((weight) => weight.module)).toEqual(
      counted.map((module) => module.module),
    );
    // The verdict is derived from the coverage, not asserted beside it.
    const normal = Number(/WEIGHTED_COVERAGE_NORMAL_MIN = ([\d.]+)/.exec(SCORING_SOURCE)?.[1]);
    const provisional = Number(
      /WEIGHTED_COVERAGE_PROVISIONAL_MIN = ([\d.]+)/.exec(SCORING_SOURCE)?.[1],
    );
    expect(normal).toBe(0.8);
    expect(provisional).toBe(0.5);
    expect(overall.verdict).toBe(
      overall.weightedCoverage >= normal
        ? 'normal'
        : overall.weightedCoverage >= provisional
          ? 'provisional'
          : 'insufficient_data',
    );
    // And it is a reading the product would call normal, so the chip beside the
    // dial is not "Insufficient data" over five real scores.
    expect(overall.verdict).toBe('normal');
  });

  // The card for a side score says so on a real report (`metaSideScore`), and
  // the example drew the same card without it while averaging its number into
  // the dial above.
  it.each(['en', 'uk'] as const)(
    'says which section is scored on its own (%s)',
    async (language) => {
      await openExample(language);
      const names = exampleReportCopy[language].sectionNames;
      const sideScores = EXAMPLE_DASHBOARD.modules.filter((module) =>
        SIDE_SCORE_MODULES.includes(module.module),
      );
      expect(sideScores.length).toBeGreaterThan(0);
      const note = copy[language].report.metaSideScore;
      for (const module of sideScores) {
        const card = Array.from(document.querySelectorAll('.example-sections__item')).find((item) =>
          item.textContent?.includes(names[module.module] ?? module.module),
        );
        expect(card?.textContent).toContain(note);
      }
      // And only those cards carry it.
      expect(document.querySelectorAll('.example-sections__item')).toHaveLength(
        EXAMPLE_DASHBOARD.modules.length,
      );
      const carrying = Array.from(document.querySelectorAll('.example-sections__item')).filter(
        (item) => item.textContent?.includes(note),
      );
      expect(carrying).toHaveLength(sideScores.length);
    },
  );

  // The example used to stop twelve addresses into a fourteen-address site and
  // attribute the two it missed to the owner's own page setting — which is what
  // the API would do, and which printed "Your scan settings limit this check to
  // 12 pages… Raise the page limit before the next check" to a reader with no
  // account and no settings. The crawl reads the whole site now, so there is no
  // limit to attribute.
  it('is not limited by anything, and says nothing about a limit', () => {
    const summary = EXAMPLE_DASHBOARD.scan.crawlSummary;
    if (summary == null) throw new Error('expected the crawl summary');
    expect(summary.pagesRead).toBe(summary.urlsDiscovered);
    expect(summary.urlsOverLimit).toBe(0);
    expect(summary.urlsBlockedByRobots).toBe(0);
    // The API attributes a short crawl by comparing the scan's own page setting
    // with the plan's ceiling, so a setting above the addresses found cannot be
    // what stopped it.
    expect(summary.maxPages).toBeGreaterThanOrEqual(summary.urlsDiscovered);
    expect(summary.limitedBy).toBeNull();
    expect(EXAMPLE_DASHBOARD.scan.scope.maxPages).toBe(summary.maxPages);
  });

  // Kept conditional rather than deleted: the day the fixture is a limited
  // crawl again, this is the rule that stops it printing "a larger plan is
  // needed" on a report for the largest plan there is.
  it('would still blame a limit on whoever the product would blame it on', () => {
    const summary = EXAMPLE_DASHBOARD.scan.crawlSummary;
    if (summary == null) throw new Error('expected the crawl summary');
    const planLimit = PLAN_URL_LIMIT[EXAMPLE_DASHBOARD.scan.plan];
    if (summary.maxPages < planLimit && summary.urlsOverLimit > 0) {
      expect(summary.limitedBy).toBe('owner');
    } else {
      expect(summary.limitedBy).toBeNull();
    }
  });

  it.each(['en', 'uk'] as const)(
    'says the whole site was read, and names no limit (%s)',
    async (language) => {
      await openExample(language);
      const report = copy[language].report;
      const panel = screen.getByRole('region', { name: report.siteCoverageTitle });
      const limit = String(EXAMPLE_DASHBOARD.scan.crawlSummary?.maxPages);

      expect(panel.textContent).toContain(report.siteCoverageComplete);
      // Neither of the two sentences that ask the reader to change something
      // they do not have.
      expect(panel.textContent).not.toContain(
        report.siteCoverageLimitedByOwner.replace('{limit}', limit),
      );
      expect(panel.textContent).not.toContain(
        report.siteCoverageLimitedByPlan.replace('{limit}', limit),
      );
      expect(panel.textContent).not.toContain(report.siteCoveragePartial);
    },
  );

  // Two figures and one sentence saying how they differ. The page used to show
  // three percentages — the checks done overall, the addresses read, and one
  // section's own checks — with nothing to tell them apart.
  it.each(['en', 'uk'] as const)(
    'explains how "addresses read" and "checks done" differ (%s)',
    async (language) => {
      await openExample(language);
      const t = exampleReportCopy[language];
      const report = copy[language].report;
      const callout = screen.getByText(t.coverageCallout);

      // The sentence names both figures by the words the page prints them under.
      expect(callout.textContent).toContain(report.helpCoverageTerm.toLowerCase());
      // And the section it is about really is below 100%, so the sentence has
      // something to point at.
      const partial = EXAMPLE_DASHBOARD.modules.filter((module) => (module.coverage ?? 0) < 1);
      expect(partial.length).toBeGreaterThan(0);
      // Which is the one the reader can see a reason for.
      for (const module of partial) {
        expect(module.statusReason).not.toBeNull();
        const card = Array.from(document.querySelectorAll('.example-sections__item')).find((item) =>
          item.textContent?.includes(t.sectionNames[module.module] ?? module.module),
        );
        expect(card?.textContent).toContain(report.moduleReason.performanceSamplesIncomplete);
      }
    },
  );

  // Two counts the page states in words. Both were wrong: it called a report
  // drawing six of Complete's ten sections "every section", and introduced the
  // full list as "the same six problems" directly under a block showing five.
  it.each(['en', 'uk'] as const)('states its own two counts truthfully (%s)', (language) => {
    const t = exampleReportCopy[language];
    expect(PLAN_MODULES.Complete).toHaveLength(10);
    expect(EXAMPLE_DASHBOARD.modules).toHaveLength(6);
    expect(EXAMPLE_RULE_IDS).toHaveLength(6);

    const six = language === 'en' ? /six/i : /шість/;
    const ten = language === 'en' ? /ten/i : /десяти/;
    // The plan line, and the sentence that introduces the sections, say the
    // same thing: six of ten, not all ten.
    expect(t.planValue).toMatch(six);
    expect(t.planValue).toMatch(ten);
    expect(t.planValue).not.toMatch(language === 'en' ? /every section/i : /усі розділи/i);
    expect(t.sectionsLead).toMatch(six);
    expect(t.sectionsLead).toMatch(ten);
    // "Fix these first" shows five of the six; the full list is those six, and
    // says so rather than calling itself "the same" six — or "all" of them,
    // which it is not (see the shared-evidence pin below).
    expect(t.findingsLead).toMatch(language === 'en' ? six : /шість/i);
    expect(t.findingsHeading).toMatch(language === 'en' ? six : /шість/i);
    expect(t.findingsLead).toMatch(
      language === 'en'
        ? /^Six of its problems/
        : // «сайт» is masculine: «її … вона» agreed with nothing in the sentence.
          /^Шість проблем цього сайту, а не всі, які він має\./,
    );
  });

  it.each(['en', 'uk'] as const)(
    'shows every finding with what, what to do and how urgent (%s)',
    async (language) => {
      await openExample(language);
      const f = findingsCopy[language];
      const list = document.querySelector('.example-findings');
      if (list === null) throw new Error('expected the findings list');
      const entries = within(list as HTMLElement);

      for (const ruleId of EXAMPLE_RULE_IDS) {
        expect(entries.getByRole('heading', { name: problemTitle(ruleId, language) })).toBeTruthy();
      }
      // The two questions a reader opens a card for, once per problem, and why
      // it matters as the label of one more fold inside it.
      for (const label of [f.issues.explainerWhat, f.issues.explainerFix, f.issues.explainerWhy]) {
        expect(entries.getAllByText(label)).toHaveLength(EXAMPLE_RULE_IDS.length);
      }
      // "What one finding is" explained the product's unit through itself on a
      // page whose reader has never seen a finding. The sentence under "Fix
      // these first" says it once, in plain words, instead.
      expect(list.textContent).not.toContain(f.issues.explainerCount);
      // And what the urgency word means, for every level the example shows.
      for (const severity of new Set(EXAMPLE_ISSUES.map((issue) => issue.severity))) {
        expect(list.textContent).toContain(f.severityMeaning[severity]);
      }
    },
  );

  // Six cards open at once, each repeating the same four sub-headings, made
  // thirteen phone screens of a page whose job is to be read in two minutes.
  it.each(['en', 'uk'] as const)(
    'opens the first problem and folds the rest (%s)',
    async (language) => {
      await openExample(language);
      const cards = Array.from(document.querySelectorAll('details.example-finding'));
      expect(cards).toHaveLength(EXAMPLE_RULE_IDS.length);
      expect(cards.map((card) => card.hasAttribute('open'))).toEqual(
        cards.map((_, index) => index === 0),
      );
      // A closed card still shows what a reader chooses by: the plain headline
      // and how urgent it is, both inside its own summary.
      cards.forEach((card, index) => {
        const group = EXAMPLE_SUMMARY.groups[index];
        if (group === undefined) throw new Error('expected a problem for every card');
        const summary = card.querySelector('summary');
        expect(summary?.textContent).toContain(problemTitle(group.ruleId, language));
        expect(summary?.textContent).toContain(findingsCopy[language].severity[group.severity]);
      });
      // Why it matters is kept, one fold deeper, and closed with the card.
      for (const fold of document.querySelectorAll('.example-finding__more')) {
        expect(fold.hasAttribute('open')).toBe(false);
      }
    },
  );

  // "Something may hold visitors back from contacting you" said only that
  // something may make a visitor hesitate, and never what. Every card says
  // what this problem is on this particular salon's site.
  it.each(['en', 'uk'] as const)(
    'says what each problem means, on every card (%s)',
    async (language) => {
      await openExample(language);
      unfoldEveryProblem();
      const t = exampleReportCopy[language];

      for (const [index, group] of EXAMPLE_SUMMARY.groups.entries()) {
        const meaning = t.findingMeanings[group.ruleId];
        expect(meaning, `${group.ruleId} has no "what it means" sentence`).toBeDefined();
        const card = document.querySelectorAll('details.example-finding')[index];
        expect(card?.textContent).toContain(meaning);
      }
      // And no sentence is left over for a problem the example no longer shows.
      expect(Object.keys(t.findingMeanings).sort()).toEqual([...EXAMPLE_RULE_IDS].sort());
    },
  );

  it('shows the score, the coverage and "Fix these first", each with a plain callout', async () => {
    await openExample();
    const t = exampleReportCopy.en;

    // The coverage panel carries its own title, so the region takes it as a
    // label rather than repeating it as a heading.
    expect(screen.getByRole('region', { name: copy.en.report.siteCoverageTitle })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: findingsCopy.en.fixFirst.heading, level: 2 }),
    ).toBeTruthy();
    // The two one-sentence explanations of what a number means, and the unit
    // sentence under "Fix these first" — which sits under the heading rather
    // than below the rows, so the reader meets it before the numbers.
    for (const callout of [t.scoreCallout, t.coverageCallout]) {
      expect(screen.getByText(callout)).toBeTruthy();
    }
    const unit = screen.getByText(t.fixFirstCallout);
    expect(document.querySelector('#example-fix-first')?.contains(unit)).toBe(true);
    // The block prints `fixFirst.pages`, which is a count of findings and never
    // of pages; the sentence used to say "how many pages it was found on".
    const block = document.querySelector('#example-fix-first') as HTMLElement;
    const first = EXAMPLE_SUMMARY.groups[0];
    if (first === undefined) throw new Error('expected a first problem');
    expect(block.textContent).toContain(findingsCopy.en.fixFirst.pages(first.openIssues));
    expect(t.fixFirstCallout).not.toMatch(/how many pages/i);
    // The score itself and the coverage beside it, both from the fixture — read
    // off it rather than typed here, so the two can never drift apart.
    const { overall } = EXAMPLE_DASHBOARD;
    const dial = document.querySelector('.score-dial');
    expect(dial?.querySelector('.score-dial__number')?.textContent).toBe(overall.score?.toFixed(2));
    expect(dial?.querySelector('.score-dial__coverage')?.textContent).toBe(
      copy.en.report.coverageValue.replace(
        '{percent}',
        (overall.weightedCoverage * 100).toFixed(0),
      ),
    );
  });

  it('shows the exact message the owner would send on', async () => {
    await openExample();
    const task = document.querySelector('.example-task');
    if (task === null) throw new Error('expected the developer message');
    // Produced by the real generator, so it is the message the product sends.
    expect(task.textContent).toContain(
      findingsCopy.en.task.heading(problemTitle('SEO-TECH-006', 'en')),
    );
    expect(task.textContent).toContain(EXAMPLE_DOMAIN);
    // And it reports the same reach as the card above it: the message said
    // "Found on 1 page" while the card said three, because the fixture held
    // one finding for a problem it claimed reached three.
    const group = EXAMPLE_SUMMARY.groups[0];
    if (group === undefined) throw new Error('expected a first problem');
    const first = document.querySelector('.example-finding');
    expect(first?.textContent).toContain(String(group.openIssues));
    expect(task.textContent).toContain(String(group.openIssues));
  });

  // The rows were the report's own buttons, reading "Open", under a sentence
  // promising nothing on the page could be pressed. An "Open" that only scrolls
  // promises a screen this reader does not have.
  it.each(['en', 'uk'] as const)(
    'links each row of "Fix these first" to that problem further down the page (%s)',
    async (language) => {
      await openExample(language);
      const block = document.querySelector('#example-fix-first');
      if (block === null) throw new Error('expected the fix-first block');
      const rows = within(block as HTMLElement).getAllByRole('link');
      expect(rows.length).toBeGreaterThan(0);
      // Not a control that acts: every one of them is a link, and it says it
      // moves the reader down the page.
      expect(within(block as HTMLElement).queryAllByRole('button')).toEqual([]);
      for (const row of rows.slice(0, -1)) {
        expect(row.textContent).toBe(exampleReportCopy[language].showBelow);
      }
      for (const row of rows) {
        const target = (row.getAttribute('href') ?? '').slice(1);
        expect(target).not.toBe('');
        expect(document.getElementById(target)).not.toBeNull();
      }
    },
  );

  // "On your own report this is a button. Here it is just the text, so nothing
  // on this page can be pressed by accident" — said over five rows of buttons.
  it.each(['en', 'uk'] as const)('describes its own controls truthfully (%s)', async (language) => {
    await openExample(language);
    const note = exampleReportCopy[language].taskNote;
    expect(screen.getByText(note)).toBeTruthy();
    // No claim that nothing on the page can be pressed: the folds and the
    // jumps can be, and they do what they say.
    expect(note).not.toMatch(language === 'en' ? /pressed by accident/i : /натиснути випадково/);
  });
});

/**
 * Wording that introduces the list of problems as a selection, and wording that
 * claims it is everything the site has.
 *
 * The list is six of this site's problems and not all of them: see the pin
 * below. The sentence that introduces it has to say so.
 */
const SELECTION_WORDING = { en: /not every problem/i, uk: /а не всі/ } as const;
const COMPLETENESS_WORDING = {
  // "not every problem it has" is the honest half of the sentence, so the claim
  // is only a claim when nothing negates it.
  en: /(?<!not )\b(all|every) (six|problem)/i,
  // No `\b` on the Ukrainian half: JavaScript defines a word boundary on ASCII
  // word characters only, so `\bусі` can never match at the start of a sentence
  // and the pin was silently passing on «Усі шість проблем».
  uk: /(?<!не )(усі|всі) (шість|проблем)/i,
} as const;

// The example reports SEO-ONPAGE-005 — images with no `alt` attribute — and
// gives Accessibility a Completed 18 of 18. But §14 has `packages/rules` report
// A11Y-002 over exactly that evidence on purpose: one shared
// `IMG_ALT_EVIDENCE_CATEGORY` group, two findings, two tariff weights. So a real
// Complete report of three pages with alt-less images would carry A11Y-002 three
// times too, and "All six problems" over this fixture was false. The honest fix
// was the sentence, not a seventh invented rule — and this is what keeps the two
// decisions tied together.
describe('the list of problems it shows', () => {
  /** Every rule in `packages/rules` whose evidence is filed under a shared category. */
  function rulesByEvidenceCategory(): ReadonlyMap<string, readonly string[]> {
    const root = resolve(process.cwd(), '..', '..', 'packages', 'rules', 'src');
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.includes('.test.'))
      .map((file) => ({ file, source: readFileSync(resolve(root, file), 'utf8') }));

    const byCategory = new Map<string, string[]>();
    for (const { source } of sources) {
      // Only a rule that groups its evidence with another rule's can be a twin.
      const category = /evidenceGroupId\(\s*([A-Za-z0-9_]+)\s*,/.exec(source)?.[1];
      const ruleId = /requireDescriptor\('([A-Z0-9-]+)'\)/.exec(source)?.[1];
      if (category === undefined || ruleId === undefined) continue;
      byCategory.set(category, [...(byCategory.get(category) ?? []), ruleId]);
    }
    return byCategory;
  }

  it('reads the rules it is checked against', () => {
    // Guards the scanner: a renamed helper would leave every assertion below
    // looking at an empty map and passing by accident.
    const byCategory = rulesByEvidenceCategory();
    expect(byCategory.get('IMG_ALT_EVIDENCE_CATEGORY')).toEqual(
      expect.arrayContaining(['SEO-ONPAGE-005', 'A11Y-002']),
    );
  });

  it.each(['en', 'uk'] as const)(
    'calls itself a selection while it shows one of a pair the product reports together (%s)',
    (language) => {
      const t = exampleReportCopy[language];
      const pairs = [...rulesByEvidenceCategory().values()].filter((ids) => ids.length > 1);
      expect(pairs.length).toBeGreaterThan(0);

      const split = pairs.filter(
        (ids) =>
          ids.some((id) => EXAMPLE_RULE_IDS.includes(id)) &&
          ids.some((id) => !EXAMPLE_RULE_IDS.includes(id)),
      );
      // Either every twin of every rule the example shows is shown too, or the
      // copy says the list is a selection. Both are honest; claiming
      // completeness over a split pair is not.
      if (split.length === 0) return;
      expect(t.findingsLead).toMatch(SELECTION_WORDING[language]);
      for (const sentence of [t.findingsHeading, t.findingsLead]) {
        expect({ sentence, claimsAll: COMPLETENESS_WORDING[language].test(sentence) }).toEqual({
          sentence,
          claimsAll: false,
        });
      }
    },
  );
});

describe('nothing on it acts', () => {
  it('offers no download, no export and no scan', async () => {
    await openExample();
    const report = document.querySelector('.example-report') as HTMLElement;
    const inside = within(report);

    for (const name of [/download/i, /^PDF$/, /^JSON$/, /^CSV$/, /print/i, /run scan/i]) {
      expect(inside.queryByRole('button', { name })).toBeNull();
      expect(inside.queryByRole('link', { name })).toBeNull();
    }
    // No status dropdown — the one control on a real finding that persists.
    expect(report.querySelectorAll('select')).toHaveLength(0);
    // No download link of any kind.
    expect(report.querySelectorAll('a[download]')).toHaveLength(0);
    // And the message for the developer is read-only text, not a form control.
    expect(report.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('ends on the free check and the pages that explain more, not on a purchase', async () => {
    await openExample();
    const cta = document.querySelector('.example-cta') as HTMLElement;
    const inside = within(cta);

    expect(inside.getByRole('link', { name: exampleReportCopy.en.ctaFree })).toHaveAttribute(
      'href',
      '/',
    );
    expect(inside.getByRole('link', { name: exampleReportCopy.en.ctaCoverage })).toHaveAttribute(
      'href',
      '/checks',
    );
    // No price and no way to start a purchase. "It needs no payment and no
    // card" is the opposite of a purchase button, so the pin is on the figure
    // and on where the links go, not on the word.
    expect(cta.textContent).not.toMatch(/\$\d|\bUSD\b|\b\d+ USD\b/);
    for (const link of within(cta).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/(checks|faq)?$/);
    }
  });
});
