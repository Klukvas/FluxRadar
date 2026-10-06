// What a finished report reads like, shown before anyone pays for one.
//
// A salon owner who read the home page could not picture the product: the hero
// promises "every signal" and the instrument panel shows dashes. This block is
// the answer — three findings on a made-up site, written the way the report
// writes them: what is wrong, why it costs customers, what to do.
//
// It is built from copy rather than a screenshot so it reads in both languages,
// scales to a phone, and never drifts into showing a real customer's site. It is
// labelled as an example in its heading area and in its accessible name, so it
// cannot be mistaken for a result about the visitor's own website.
//
// Three findings, and it says which three: they are an extract of the six in
// /example-report, and their numbers come from that page's own fixture
// (`example-home-preview.ts`) rather than from a second set written here. Both
// described one made-up salon and disagreed about it.

import { EXAMPLE_REPORT_PATH } from './app-routes';
import {
  homePreviewFindings,
  homePreviewLead,
  homePreviewSummary,
  type HomePreviewFinding,
} from './example-home-preview';
import { copy, type Language } from './i18n';
import './styles/home-plain-language.css';

export function ExampleReport(props: { language: Language }) {
  const t = copy[props.language].home.example;
  const findings = homePreviewFindings(props.language);
  return (
    <section className="home__section home-example" aria-labelledby="example-report-title">
      <div className="home__section-head">
        <div className="home__eyebrow">
          <span className="home__eyebrow-index">02a</span> {t.eyebrow}
        </div>
        <h2 id="example-report-title">{t.title}</h2>
        <p>{homePreviewLead(props.language)}</p>
      </div>
      <figure className="home-example__window" aria-label={t.windowLabel}>
        <figcaption className="home-example__bar">
          <span className="home-example__badge">{t.badge}</span>
          <span className="home-example__site technical">{t.site}</span>
          <span className="home-example__summary">{homePreviewSummary(props.language)}</span>
        </figcaption>
        {/* list-style: none drops the list role in Safari; say it explicitly. */}
        <ol className="home-example__findings" role="list">
          {findings.map((finding) => (
            <PreviewFinding
              key={finding.ruleId}
              finding={finding}
              whereLabel={t.whereLabel}
              actionLabel={t.actionLabel}
            />
          ))}
        </ol>
      </figure>
      {/* Three findings answer "what does a finding look like"; they do not
          answer "what do I get". The whole report does, and it needs no
          account to read. */}
      <p className="home-example__more">
        <a href={EXAMPLE_REPORT_PATH}>
          {t.fullLink} <span aria-hidden="true">→</span>
        </a>
      </p>
    </section>
  );
}

function PreviewFinding(props: {
  finding: HomePreviewFinding;
  whereLabel: string;
  actionLabel: string;
}) {
  const { finding } = props;
  return (
    <li className={`home-example__finding home-example__finding--${finding.tone}`}>
      <div className="home-example__meta">
        <span className="home-example__severity">{finding.severity}</span>
        <span className="home-example__where">
          {props.whereLabel}: {finding.where}
        </span>
      </div>
      <h3 className="home-example__title">{finding.title}</h3>
      <p className="home-example__action">
        <strong>{props.actionLabel}:</strong> {finding.action}
      </p>
    </li>
  );
}
