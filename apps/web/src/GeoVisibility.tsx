// The report's "Visibility by engine" block (T6): one card per AI engine that
// answered at least one question, with the counts, shares and score the scan
// stored — never recomputed here from the raw answers.
//
// It lives beside `ModuleChecks.tsx` rather than inside it: the three
// components here share nothing with the module-check rows but the copy
// helpers, and the panel file was already over the size a single file should
// reach.
//
// Two rules the copy and the markup both have to keep:
//
//   - A share divides by the answers in which that signal could be *measured*
//     (geo-measurability.ts). A signal measurable in no answer has a null
//     share and says "not measurable" — never 0%, which would read as a fail.
//   - The score is informational only and sits outside the overall audit
//     score; a provider without one carries the reason it has none.

import { pathForScreen } from './app-routes';
import type { GeoProviderVisibility, GeoVisibilitySummary } from './api';
import { copy, fillCopy, type Language } from './i18n';

/** A percentage rounded for display; the stored share stays a 0..1 fraction. */
export function percentOf(share: number): number {
  return Math.round(share * 100);
}

function GeoCitedInstead(props: {
  citedInstead: GeoProviderVisibility['citedInstead'];
  language: Language;
}) {
  const t = copy[props.language].report;
  return (
    <div className="geo-visibility-card__cited-instead">
      <strong>{t.geoVisibilityCitedInsteadHeading}</strong>
      {props.citedInstead.length === 0 ? (
        <p className="muted">{t.geoVisibilityCitedInsteadNone}</p>
      ) : (
        <>
          <ul>
            {props.citedInstead.map((entry) => (
              <li key={entry.hostname} className="technical">
                {fillCopy(t.geoVisibilityCitedInsteadEntry, {
                  hostname: entry.hostname,
                  count: entry.answerCount,
                })}
              </li>
            ))}
          </ul>
          <p className="muted">{t.geoVisibilityCitedInsteadNote}</p>
        </>
      )}
    </div>
  );
}

/**
 * The "Share of voice" row (T7): the brand's share of mentions against its
 * configured competitors, or — with none configured — a note linking to the
 * profile form where they are added. Absent (`null`) on a scan that predates
 * the field is treated the same as "no competitors configured": either way
 * there is nothing to show but the invitation to configure them.
 */
/**
 * How many answers named the brand only as part of a competitor's name
 * (T7-fix3 L2): the brand-mention signal counts "Bolt" inside "Bolt Food" as
 * a mention, `shareOfVoice.brandMentionsInScope` deliberately does not, so
 * the difference is exactly the count the two disagree on. Never negative —
 * `brandMentionsInScope` counts a subset of what `brandMentionedCount` does.
 */
export function ownNameOnlyCount(
  shareOfVoice: NonNullable<GeoProviderVisibility['shareOfVoice']>,
  brandMentionedCount: number,
): number {
  return Math.max(0, brandMentionedCount - shareOfVoice.brandMentionsInScope);
}

function GeoShareOfVoice(props: {
  shareOfVoice: GeoProviderVisibility['shareOfVoice'];
  brandMentionedCount: number;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { shareOfVoice } = props;
  if (shareOfVoice === null || shareOfVoice.competitors.length === 0) {
    return (
      <div className="geo-visibility-card__share-of-voice">
        <strong>{t.geoShareOfVoiceHeading}</strong>
        <p className="muted">
          {t.geoShareOfVoiceNone}{' '}
          <a href={pathForScreen('desktop', null)}>{t.geoShareOfVoiceNoneLink}</a>
        </p>
      </div>
    );
  }
  const ownNameOnly = ownNameOnlyCount(shareOfVoice, props.brandMentionedCount);
  return (
    <div className="geo-visibility-card__share-of-voice">
      <strong>{t.geoShareOfVoiceHeading}</strong>
      <ul>
        <li>
          {shareOfVoice.brandShare === null
            ? t.geoShareOfVoiceBrandNotMeasured
            : fillCopy(t.geoShareOfVoiceBrandRow, { percent: percentOf(shareOfVoice.brandShare) })}
        </li>
        {shareOfVoice.competitors.map((competitor) => (
          <li key={competitor.name}>
            {competitor.share === null
              ? fillCopy(t.geoShareOfVoiceCompetitorNotMeasured, { name: competitor.name })
              : fillCopy(t.geoShareOfVoiceCompetitorRow, {
                  name: competitor.name,
                  percent: percentOf(competitor.share),
                })}
          </li>
        ))}
      </ul>
      {ownNameOnly > 0 ? (
        <p className="muted">
          {fillCopy(t.geoShareOfVoiceOwnNameOnlyNote, { count: ownNameOnly })}
        </p>
      ) : null}
    </div>
  );
}

/** Why this engine has no score, in the reader's words. */
function noScoreText(provider: GeoProviderVisibility, language: Language, min: number): string {
  const t = copy[language].report;
  return provider.scoreUnavailableReason === 'not-measurable'
    ? t.geoVisibilityNotMeasurable
    : fillCopy(t.geoVisibilityNotEnoughAnswers, {
        min,
        brand: provider.brandMeasuredCount,
        domain: provider.domainMeasuredCount,
      });
}

/** What a partial score counts, when it was built from only one signal. */
function scoreBasisText(provider: GeoProviderVisibility, language: Language): string | null {
  const t = copy[language].report;
  if (provider.scoreBasis === 'brand-only') {
    return fillCopy(t.geoVisibilityScoreBasisBrandOnly, { domain: provider.domainMeasuredCount });
  }
  if (provider.scoreBasis === 'domain-only') {
    return fillCopy(t.geoVisibilityScoreBasisDomainOnly, { brand: provider.brandMeasuredCount });
  }
  return null;
}

/** One signal's line: a share of measurable answers, or the honest "not measurable". */
function GeoVisibilitySignal(props: {
  measured: number;
  mentioned: number;
  share: number | null;
  template: string;
  notMeasurable: string;
}) {
  if (props.share === null) {
    return <p className="muted">{props.notMeasurable}</p>;
  }
  return (
    <p className="muted">
      {fillCopy(props.template, {
        count: props.mentioned,
        total: props.measured,
        percent: percentOf(props.share),
      })}
    </p>
  );
}

function GeoVisibilityCard(props: {
  provider: GeoProviderVisibility;
  minMeasuredForScore: number;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { provider } = props;
  const basisText = scoreBasisText(provider, props.language);
  return (
    <article className="geo-visibility-card">
      <div className="split geo-visibility-card__header">
        <strong>{provider.label}</strong>
        {provider.visibilityScore === null ? (
          <span className="geo-visibility-card__score geo-visibility-card__score--none">
            {noScoreText(provider, props.language, props.minMeasuredForScore)}
          </span>
        ) : (
          // The label is its own element rather than an aria-label on the
          // number: where an aria-label is exposed it *replaces* the text, so
          // assistive tech heard "Visibility score" and never the score.
          <span className="geo-visibility-card__score">
            <span className="sr-only">{t.geoVisibilityScoreLabel}</span> {provider.visibilityScore}
            /100
          </span>
        )}
      </div>
      {basisText === null ? null : (
        <p className="muted geo-visibility-card__score-basis">{basisText}</p>
      )}
      <GeoVisibilitySignal
        measured={provider.brandMeasuredCount}
        mentioned={provider.brandMentionedCount}
        share={provider.brandMentionedShare}
        template={t.geoVisibilityBrandShare}
        notMeasurable={t.geoVisibilityBrandNotMeasurable}
      />
      <GeoVisibilitySignal
        measured={provider.domainMeasuredCount}
        mentioned={provider.domainCitedCount}
        share={provider.domainCitedShare}
        template={t.geoVisibilityDomainShare}
        notMeasurable={t.geoVisibilityDomainNotMeasurable}
      />
      <GeoCitedInstead citedInstead={provider.citedInstead} language={props.language} />
      <GeoShareOfVoice
        shareOfVoice={provider.shareOfVoice}
        brandMentionedCount={provider.brandMentionedCount}
        language={props.language}
      />
    </article>
  );
}

/** The "Visibility by engine" block: one card per provider, before the answer cards. */
export function GeoVisibilityByEngine(props: {
  summary: GeoVisibilitySummary | null;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { summary } = props;
  if (summary === null) {
    // Either this scan predates the summary, or the stored record no longer
    // parses — the reader is told the same honest thing either way, and it is
    // never recomputed here from the raw answers.
    return (
      <div className="module-checks__group">
        <h4 className="module-checks__subheading">{t.geoVisibilityHeading}</h4>
        <p className="muted">{t.geoVisibilityUnavailable}</p>
      </div>
    );
  }
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.geoVisibilityHeading}</h4>
      <p className="muted">
        {fillCopy(t.geoVisibilityLead, {
          min: summary.minMeasuredForScore,
          brandWeight: percentOf(summary.weightBrand),
          domainWeight: percentOf(summary.weightDomain),
        })}
      </p>
      <div className="geo-visibility__grid">
        {summary.providers.map((provider) => (
          <GeoVisibilityCard
            key={provider.provider}
            provider={provider}
            minMeasuredForScore={summary.minMeasuredForScore}
            language={props.language}
          />
        ))}
      </div>
    </div>
  );
}
