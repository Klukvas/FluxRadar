// The public example report (/example-report).
//
// A visitor who has not paid cannot see a report, and nothing on the site let
// them picture one: the hero promises "every signal" and the instrument panel
// beside it shows dashes. This is a whole finished report for a made-up salon,
// readable with no account, in both languages, making no network request.
//
// It is assembled from the REAL report components over typed fixture data
// (`example-report-fixture.ts`), so the page cannot drift away from the product:
//
//  · the score dial, the coverage panel, the status chips and the measurement
//    bars are the report's own components;
//  · "Fix these first" is the report's own block, fed the fixture's summary;
//  · every finding's "what / why / what to do" is the real plain-language
//    explanation of a real rule (`finding-explainers.ts`), not prose written
//    here, and the severities and their meanings come from `findings-copy.ts`;
//  · the ready message for a developer is produced by the real
//    `developerTaskText`.
//
// What is NOT reused is the Issue Center's table and the report's action row.
// Both exist to change something — a status dropdown that persists, a PDF, a
// JSON export, "run again" — and an example must offer no control that acts.
// The table's own columns are a section name, an address and a status, which is
// exactly the technical reading this page is written to avoid.
//
// Where the example departs from the report it does so through a prop, so the
// report itself is untouched: `FixFirst` takes in-page links instead of its
// buttons (`jumps`), and the problem cards are folded here and not there. A
// reader with no report of their own met six cards open at once, each repeating
// the same four sub-headings — thirteen screens of them on a phone.
//
// The document shell is this page's own. It used to be /faq's `legal-layout`,
// which reserves a 210px rail for the sticky index this page does not have; see
// `example-report.css`.

import { useCallback, useEffect, useRef, useState } from 'react';

import { CreatedByFluxLab, MenuBar, ProgressBar, ScoreDial, StatusChip } from './components';
import { developerTaskText } from './developer-task';
import { exampleReportCopy } from './example-report-copy';
import {
  EXAMPLE_DASHBOARD,
  EXAMPLE_DOMAIN,
  EXAMPLE_ISSUES,
  EXAMPLE_RULE_IDS,
  EXAMPLE_SIDE_SCORE_MODULES,
  EXAMPLE_SUMMARY,
} from './example-report-fixture';
import { findingCountsPages, findingExplainer, problemTitle } from './finding-explainers';
import { findingsCopy } from './findings-copy';
import { copy, type Language } from './i18n';
import type { IssueRuleGroup } from './api';
import { moduleStatusReasons } from './module-status';
import { FixFirst } from './ReportNextSteps';
import { ruleTitle } from './rule-titles';
import { SiteCoveragePanel } from './SiteCoverage';
import { moduleResultLabel, moduleScoreLabel } from './scan-status';
import './styles/example-report.css';
import './styles/findings.css';

/** The id one finding's full entry is anchored at, so "Fix these first" can reach it. */
function findingAnchor(ruleId: string): string {
  return `example-finding-${ruleId.toLowerCase()}`;
}

/** The problem a page address names, or null when it names something else. */
function problemInHash(hash: string, ruleIds: readonly string[]): string | null {
  const anchor = hash.replace(/^#/, '');
  return ruleIds.find((ruleId) => findingAnchor(ruleId) === anchor) ?? null;
}

/**
 * Which problem card is unfolded: the one the reader asked for, else the first.
 *
 * A "Show below ↓" row lands on the `<li>` of a closed card, so the reader
 * pressed a link promising to show them a problem and arrived at a folded
 * headline, with one more press to work out. The card the address names opens
 * instead — on a link opened from elsewhere, on a later jump down the page, and
 * on the back button, which is the same `hashchange`.
 *
 * Only a hash that names a problem counts: "#example-glossary" and the other
 * jumps leave the cards as the reader left them. A card unfolded by hand is the
 * reader's own doing and is never folded back by this.
 *
 * Every ask carries its own number, `jump`. Pressing the row of a card already
 * asked for, after folding that card by hand, asks for the same problem at the
 * address already in the bar: a bare rule id would be the same state and no
 * `hashchange` fires, so nothing would reopen it. A new number is a new state.
 */
interface ProblemAsk {
  readonly ruleId: string;
  readonly jump: number;
}

function useProblemFromHash(
  ruleIds: readonly string[],
): readonly [ProblemAsk | null, (ruleId: string) => void] {
  const [asked, setAsked] = useState<ProblemAsk | null>(() => {
    const named = problemInHash(window.location.hash, ruleIds);
    return named === null ? null : { ruleId: named, jump: 0 };
  });
  const ask = useCallback((ruleId: string): void => {
    setAsked((previous) => ({ ruleId, jump: (previous?.jump ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    const follow = (): void => {
      const named = problemInHash(window.location.hash, ruleIds);
      if (named !== null) ask(named);
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [ruleIds, ask]);
  return [asked, ask];
}

/** Where the page's own pricing link goes: the home page's pricing section. */
const PLANS_PATH = '/plans';

export function ExampleReportScreen(props: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  /** Whether the reader has a session; false until the app knows. See `MenuBar`. */
  signedIn?: boolean;
}) {
  const { language } = props;
  return (
    <div className="app-shell legal-shell example-report-shell">
      <MenuBar
        variant="public"
        active="example-report"
        signedIn={props.signedIn}
        language={language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="legal-main" aria-labelledby="example-report-page-title">
        <PageHeader language={language} />
        {/* First on the page, before anything that could be mistaken for a
            result, and printed as well as shown (example-report.css). */}
        <ExampleBanner language={language} />
        <HowToRead language={language} />
        <ExampleDocument language={language} />
        <PageFooter language={language} />
      </main>
    </div>
  );
}

function PageHeader({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <header className="legal-header">
      <div>
        <div className="legal-kicker">
          <span className="legal-kicker__mark">▣</span>
          {t.kicker}
        </div>
        <h1 id="example-report-page-title">{t.title}</h1>
        <p className="legal-lede">{t.lead}</p>
      </div>
      <a className="legal-back" href="/">
        {t.back}
      </a>
    </header>
  );
}

function PageFooter({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <footer className="legal-footer">
      <span>{t.footerBrand}</span>
      <span>
        <a href="/">{t.footerHome}</a> · <a href="/checks">{copy[language].checks.title}</a> ·{' '}
        <a href="/faq">{copy[language].nav.faq}</a>
      </span>
      <CreatedByFluxLab language={language} />
    </footer>
  );
}

/** The report itself: one column, and no sticky index beside it. */
function ExampleDocument({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  const [openProblem, askForProblem] = useProblemFromHash(EXAMPLE_RULE_IDS);
  return (
    <div className="example-layout">
      {/* Named as the example in its own accessible name, so the first thing
          said about this document is that it is not a real site. */}
      <article className="legal-document example-report" aria-label={t.exampleLabel}>
        <DocumentNotice language={language} />
        <ScoreBlock language={language} />
        <CoverageBlock language={language} />
        <SectionsBlock language={language} />
        <FixFirstBlock language={language} onProblemJump={askForProblem} />
        <FindingsBlock language={language} openProblem={openProblem} />
        <DeveloperMessageBlock language={language} />
        <GlossaryBlock language={language} />
        <NextStepsBlock language={language} />
        <CallToActionBlock language={language} />
        <TechnicalDetails language={language} />
        <HelpBlock language={language} />
      </article>
    </div>
  );
}

/**
 * The site, the plan and the date, as a report's own header carries them.
 *
 * The plan line read "Report · Complete — six of its ten sections shown here"
 * and nothing said what Complete was, so the one word in it that is a product
 * decision was the one word left unexplained. The link goes to what each report
 * includes; it carries no price and starts no purchase, which is the whole rule
 * this page is written under.
 */
function DocumentNotice({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <div className="legal-document__notice">
      <span>
        <strong>{t.siteLabel}</strong> · <span className="technical">{EXAMPLE_DOMAIN}</span>
      </span>
      <span>
        <strong>{t.planLabel}</strong> · {t.planValue}
      </span>
      <span>
        {t.planNote} <a href={PLANS_PATH}>{t.planLink}</a>
      </span>
      <span>
        <strong>{t.dateLabel}</strong> · {t.dateValue}
      </span>
    </div>
  );
}

/** The label that must be impossible to miss, on screen and on paper. */
function ExampleBanner({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <aside className="example-banner" role="note" aria-label={t.exampleLabel}>
      <strong className="example-banner__label">{t.exampleLabel}</strong>
      <p>{t.exampleBody}</p>
    </aside>
  );
}

/**
 * Three plain steps, each a link to the part of the report it describes — and
 * the page's only index.
 *
 * It used to be the second of two: a sticky "On this page" panel listed the
 * same three steps again, and on a phone the pair stacked into eight links of
 * 15 to 17 pixels, one above the other, saying the same things twice. The two
 * jumps the panel had that this block did not — the glossary and the last
 * section — were folded in below instead, so there is one list of where to go
 * and every entry in it is a tap target (`example-report.css`).
 */
function HowToRead({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <section className="example-how" aria-labelledby="example-how-heading">
      <h2 id="example-how-heading">{t.howToRead}</h2>
      <ol className="example-how__steps">
        {t.steps.map((step) => (
          <li key={step.anchor}>
            <a href={`#${step.anchor}`}>{step.title}</a>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="example-how__more">
        <span className="example-how__more-label">{t.contents}</span>
        <a href="#example-glossary">{t.glossaryHeading}</a>
        <a href="#example-next">{t.nextHeading}</a>
      </p>
    </section>
  );
}

/**
 * One plain sentence about a number: what it means, and whether the owner has
 * to do anything about it. The complaint this answers was not that the numbers
 * were wrong but that nothing said what they were for.
 */
function Callout({ children }: { children: string }) {
  return <p className="example-callout">{children}</p>;
}

function ScoreBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  const { overall } = EXAMPLE_DASHBOARD;
  return (
    <section className="legal-section" id="example-score" aria-labelledby="example-score-heading">
      <h2 id="example-score-heading">{t.scoreHeading}</h2>
      <div className="example-score">
        <ScoreDial
          score={overall.score}
          language={language}
          verdict={overall.verdict}
          coverage={overall.weightedCoverage}
        />
        <Callout>{t.scoreCallout}</Callout>
      </div>
    </section>
  );
}

/**
 * The real coverage panel, with one sentence saying what its number is worth.
 *
 * The panel carries its own title, so this region takes that title as its
 * accessible name rather than printing it a second time as a heading over it.
 */
function CoverageBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <section className="legal-section" aria-label={copy[language].report.siteCoverageTitle}>
      <SiteCoveragePanel summary={EXAMPLE_DASHBOARD.scan.crawlSummary} language={language} />
      <Callout>{t.coverageCallout}</Callout>
    </section>
  );
}

/** Each section's own score, under a name an owner can read. */
function SectionsBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <section className="legal-section" aria-labelledby="example-sections-heading">
      <h2 id="example-sections-heading">{t.sectionsHeading}</h2>
      <p>{t.sectionsLead}</p>
      <ul className="example-sections" role="list">
        {EXAMPLE_DASHBOARD.modules.map((module) => (
          <SectionCard key={module.module} module={module} language={language} />
        ))}
      </ul>
    </section>
  );
}

function SectionCard({
  module,
  language,
}: {
  module: (typeof EXAMPLE_DASHBOARD)['modules'][number];
  language: Language;
}) {
  const t = exampleReportCopy[language];
  const report = copy[language].report;
  const name = t.sectionNames[module.module] ?? module.module;
  return (
    <li className="example-sections__item">
      <div className="example-sections__head">
        <strong>{name}</strong>
        {/* The report's own word for how a section ended, so a Ukrainian
            reader does not meet a lone English "Completed". */}
        <StatusChip status={module.status} label={moduleResultLabel(module, language)} />
      </div>
      <span className="example-sections__score">
        {t.sectionScoreLabel} {moduleScoreLabel(module, language)}
      </span>
      <ProgressBar
        variant="result"
        caption={report.helpCoverageTerm}
        value={(module.coverage ?? 0) * 100}
        label={`${name} — ${report.helpCoverageTerm}`}
      />
      {/* Why a section did not close every check, in the product's own words.
          Without it the one bar below 100% on the page was a number with no
          reason, which is the whole complaint the callouts answer. */}
      {moduleStatusReasons(module, language).map((reason) => (
        <small key={reason} className="muted">
          {reason}
        </small>
      ))}
      {/* §15 scores this section and leaves it out of the overall number. The
          report says so on its own card; the example averaged it in and said
          nothing, so the one number on the page was one the product does not
          produce. */}
      {EXAMPLE_SIDE_SCORE_MODULES.includes(module.module) ? (
        <small className="muted">{report.metaSideScore}</small>
      ) : null}
    </li>
  );
}

/**
 * The report's own "Fix these first" block, over the fixture's summary.
 *
 * On a report each row's button opens that problem's findings — a screen this
 * reader does not have. Here the rows are links to the problem's own entry
 * further down this page, which is the same promise kept: they used to be the
 * report's buttons, reading "Open" and only scrolling, under a sentence saying
 * nothing on the page could be pressed.
 */
function FixFirstBlock({
  language,
  onProblemJump,
}: {
  language: Language;
  onProblemJump: (ruleId: string) => void;
}) {
  const t = exampleReportCopy[language];
  return (
    // A div, not a section: `FixFirst` is already a region named by its own
    // heading, and wrapping it in a second one pointed at the same heading id
    // announced two nested regions with one name. The id stays — it is what
    // "2. Read Fix these first" jumps to — and belongs to nothing else.
    <div className="legal-section" id="example-fix-first">
      <FixFirst
        summary={EXAMPLE_SUMMARY}
        language={language}
        // Second-level here: every other block on this page is, and an h3
        // between two h2s would read as a subsection of the one above it.
        headingLevel={2}
        // What the number beside each row counts, said once and under the
        // heading, where a reader meets it before the rows.
        unitNote={t.fixFirstCallout}
        jumps={{
          problemHref: (ruleId) => `#${findingAnchor(ruleId)}`,
          allHref: '#example-findings',
          openLabel: t.showBelow,
          // A row pressed while its own address is already in the bar fires no
          // `hashchange`, so the press is reported as well as followed. Each
          // report is a new ask with its own number, which is what reopens a
          // card the reader folded after the first press (`useProblemFromHash`).
          onProblemJump,
        }}
      />
    </div>
  );
}

/**
 * Every problem in full, the first one open and the rest folded — until a jump
 * from "Fix these first" names one, which opens instead.
 *
 * Six cards open at once, each with the same four sub-headings, made a page
 * thirteen phone screens long that taught nothing after the first card. A
 * closed card still shows what a reader chooses by — the plain headline and how
 * urgent it is — and what is inside answers the two questions they opened it
 * for: what was found, and what to do. Why it matters is kept, one fold deeper.
 */
function FindingsBlock({
  language,
  openProblem,
}: {
  language: Language;
  /** The reader's latest ask for a problem; null until one is asked for. */
  openProblem: ProblemAsk | null;
}) {
  const t = exampleReportCopy[language];
  return (
    <section
      className="legal-section"
      id="example-findings"
      aria-labelledby="example-findings-heading"
    >
      <h2 id="example-findings-heading">{t.findingsHeading}</h2>
      <p>{t.findingsLead}</p>
      <ol className="example-findings" role="list">
        {EXAMPLE_SUMMARY.groups.map((group, index) => {
          const isAsked = openProblem?.ruleId === group.ruleId;
          return (
            <FindingCard
              key={group.ruleId}
              group={group}
              language={language}
              unfolded={openProblem === null ? index === 0 : isAsked}
              askedJump={isAsked ? openProblem.jump : null}
            />
          );
        })}
      </ol>
      <p className="muted">{findingsCopy[language].issues.explainerScope}</p>
    </section>
  );
}

function FindingCard({
  group,
  language,
  unfolded,
  askedJump,
}: {
  group: IssueRuleGroup;
  language: Language;
  /**
   * Whether this card is open. The first one is, until a jump names another;
   * after that, whichever the reader asked for. Passed rather than left to the
   * element so a jump arrives at an open headline — but React only writes the
   * attribute when this value changes, so a card the reader unfolded by hand is
   * left alone.
   */
  unfolded: boolean;
  /**
   * The number of the latest ask for this card, or null when another card (or
   * none) was asked for. `unfolded` alone cannot reopen a card the reader
   * folded after it was asked for: asked again, the value is still true and
   * React writes nothing. A new number opens it from the effect below.
   */
  askedJump: number | null;
}) {
  const f = findingsCopy[language];
  const fold = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (askedJump !== null && fold.current !== null) fold.current.open = true;
  }, [askedJump]);
  return (
    // The id sits on the row rather than inside the fold, so a jump from "Fix
    // these first" lands on the card's own headline whether it is open or not.
    <li id={findingAnchor(group.ruleId)}>
      <details ref={fold} className="example-finding" open={unfolded}>
        <summary>
          <h3>{problemTitle(group.ruleId, language)}</h3>
          <StatusChip status={group.severity} label={f.severity[group.severity]} />
        </summary>
        <FindingBody group={group} language={language} />
      </details>
    </li>
  );
}

/** How urgent, how many, what it means here, and the two answers in full. */
function FindingBody({ group, language }: { group: IssueRuleGroup; language: Language }) {
  const t = exampleReportCopy[language];
  const f = findingsCopy[language];
  const first = EXAMPLE_ISSUES.find((issue) => issue.ruleId === group.ruleId);
  const meaning = t.findingMeanings[group.ruleId];
  return (
    <>
      <p className="example-finding__meta">
        <span className="muted">
          {t.severityLabel}: {f.severityMeaning[group.severity]}
        </span>{' '}
        ·{' '}
        {/* The product's own count sentence, so a rule that reports per link is
            not described as though it reported per page; the sentence under
            "Fix these first" says what one finding is. */}
        <span className="muted">
          {f.issues.groupCount(group.openIssues, group.issues, findingCountsPages(group.ruleId))}
        </span>
      </p>
      {/* What this problem is on this particular salon's site. Every card has
          one: without it "Something may hold visitors back from contacting
          you" told the reader that something may, and never what. */}
      {meaning === undefined ? null : <Callout>{meaning}</Callout>}
      <FindingExplanation ruleId={group.ruleId} language={language} />
      {first === undefined ? null : (
        <p className="example-finding__where muted">
          {t.exampleAddressLabel}: <span className="technical">{first.targetUrl}</span>
        </p>
      )}
    </>
  );
}

/**
 * What the check found and what to do, with why it matters one fold deeper.
 *
 * All three are the rule's own plain-language explanation. "What one finding
 * is" is left out here: it explains the product's unit through itself, to a
 * reader who has never seen a finding, and the sentence under "Fix these first"
 * says it once in plain words instead.
 */
function FindingExplanation({ ruleId, language }: { ruleId: string; language: Language }) {
  const f = findingsCopy[language];
  const explainer = findingExplainer(ruleId, language);
  if (explainer === null) return null;
  return (
    <>
      <dl className="example-finding__body">
        <dt>{f.issues.explainerWhat}</dt>
        <dd>{explainer.what}</dd>
        <dt>{f.issues.explainerFix}</dt>
        <dd>{explainer.fix}</dd>
      </dl>
      <details className="example-finding__more">
        <summary>{f.issues.explainerWhy}</summary>
        <p>{explainer.why}</p>
      </details>
    </>
  );
}

/**
 * The exact message the owner would send on, produced by the real generator.
 *
 * Read-only text rather than the report's copy button: nothing on this page may
 * act, and a reader can select the text here just as well.
 */
function DeveloperMessageBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  const first = EXAMPLE_SUMMARY.groups[0];
  if (first === undefined) return null;
  const issues = EXAMPLE_ISSUES.filter((issue) => issue.ruleId === first.ruleId);
  const message = developerTaskText({
    ruleId: first.ruleId,
    language,
    issues,
    // Every finding of the problem is in the fixture, so the message states
    // its reach exactly — and the number in it is the number on the card
    // above, because both are counted from the same list.
    allLoaded: true,
    openFindings: first.openIssues,
  });
  if (message === null) return null;
  return (
    <section className="legal-section" aria-labelledby="example-task-heading">
      <h2 id="example-task-heading">{t.taskHeading}</h2>
      <p>{t.taskLead}</p>
      <pre className="example-task" aria-label={findingsCopy[language].task.textLabel}>
        {message}
      </pre>
      <p className="muted">{t.taskNote}</p>
    </section>
  );
}

function GlossaryBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <section
      className="legal-section"
      id="example-glossary"
      aria-labelledby="example-glossary-heading"
    >
      <h2 id="example-glossary-heading">{t.glossaryHeading}</h2>
      <p>{t.glossaryLead}</p>
      <dl className="example-glossary">
        {t.glossary.map((entry) => (
          <div key={entry.term}>
            <dt>{entry.term}</dt>
            <dd>{entry.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function NextStepsBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <section className="legal-section" id="example-next" aria-labelledby="example-next-heading">
      <h2 id="example-next-heading">{t.nextHeading}</h2>
      <ol className="example-next">
        {t.nextSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The way on: the free home-page check, the coverage page and the questions.
 *
 * No purchase button. A page whose whole job is to make a report
 * understandable must not end by starting a payment. It does say what the free
 * check costs the reader first — an account, which the home page's own flow
 * opens registration for; "needs no payment and no card" was true and was not
 * the whole price.
 */
function CallToActionBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <section className="legal-section example-cta" aria-labelledby="example-cta-heading">
      <h2 id="example-cta-heading">{t.ctaHeading}</h2>
      <p>{t.ctaBody}</p>
      <p className="example-cta__links">
        <a className="button button--primary" href="/">
          {t.ctaFree}
        </a>
        <a href="/checks">{t.ctaCoverage}</a>
        <a href="/faq">{t.ctaFaq}</a>
      </p>
    </section>
  );
}

/**
 * The help list the real report ends on, so the three words it defines are
 * defined here in the same words.
 *
 * All but one of them. The report's "Findings" entry ends "Open the findings
 * list below to review them", and below it here is the technical fold and the
 * footer: this page's list of findings is above, and it has no Issue Center to
 * open. The example says so in its own words and points at "Fix these first".
 */
function HelpBlock({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  const report = copy[language].report;
  return (
    <section className="legal-section" aria-labelledby="example-help-heading">
      <h2 id="example-help-heading">{report.helpHeading}</h2>
      <dl className="example-report__help">
        <dt>{report.helpScoreTerm}</dt>
        <dd>{report.helpScoreBody}</dd>
        <dt>{report.helpCoverageTerm}</dt>
        <dd>{report.helpCoverageBody}</dd>
        <dt>{report.helpFindingsTerm}</dt>
        <dd>{t.helpFindingsBody}</dd>
      </dl>
    </section>
  );
}

/**
 * The only place on the page where a technical name appears.
 *
 * Folded, and marked as the technical details both by its own class and by the
 * heading: the page's test reads everything outside this element and fails on
 * any term from its jargon denylist.
 */
function TechnicalDetails({ language }: { language: Language }) {
  const t = exampleReportCopy[language];
  return (
    <details className="legal-section example-technical">
      <summary>{t.technicalHeading}</summary>
      <p>{t.technicalLead}</p>
      <ul className="example-technical__list">
        {EXAMPLE_DASHBOARD.modules.map((module) => (
          <li key={module.module}>
            {t.technicalSectionLabel}: <span className="technical">{module.module}</span> —{' '}
            {t.sectionNames[module.module] ?? module.module}
          </li>
        ))}
        {/* One row per problem, not per finding: the fixture holds a finding
            per affected address, and listing those would repeat one check up to
            seven times. */}
        {EXAMPLE_SUMMARY.groups.map((group) => (
          <li key={group.ruleId}>
            {t.technicalRuleLabel}: <span className="technical">{group.ruleId}</span> —{' '}
            {ruleTitle(group.ruleId, language)}
          </li>
        ))}
      </ul>
    </details>
  );
}
