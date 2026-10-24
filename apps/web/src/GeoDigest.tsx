// "What AI says about your business": the top of the AI SEO / GEO section.
//
// The answer cards below show one answer each; this block reads across all of
// them, from the summary the scan stored when it ran. Three parts, each able
// to say "not evaluated in this scan" on its own — an older report has none of
// them, a scan bought under an older notice has facts but no tone, and a part
// that did not run must never be drawn as a clean result.

import type { GeoToneLabel } from './api';
import { safeHttpUrl } from './GeoEvaluation';
import { geoDigestCopy, type GeoDigestCopy } from './geo-digest-copy';
import { geoProviderLabel } from './geo-provider-label';
import type { Language } from './i18n';
import type {
  GeoAnswerDigest,
  GeoFactDigest,
  GeoFactGroup,
  GeoPositionDigest,
  GeoProviderPosition,
  GeoProviderTone,
  GeoToneDigest,
} from './module-metadata';

/** The badge ink per tone; the word inside the badge always carries the same fact. */
export const TONE_BADGE_CLASS: Readonly<Record<GeoToneLabel, string>> = {
  positive: 'geo-evaluation__verdict geo-evaluation__verdict--matched',
  neutral: 'geo-evaluation__verdict geo-evaluation__verdict--neutral',
  negative: 'geo-evaluation__verdict geo-evaluation__verdict--contradicted',
  mixed: 'geo-evaluation__verdict geo-evaluation__verdict--partial',
};

const TONE_ORDER: readonly GeoToneLabel[] = ['positive', 'neutral', 'mixed', 'negative'];

const PROFILE_KEY_PREFIX = 'profile:';

/** What a source is called: a profile field in the reader's language, a page by its own title. */
function sourceName(group: GeoFactGroup, t: GeoDigestCopy): string {
  const { source } = group;
  if (source.kind !== 'profile' || !source.key.startsWith(PROFILE_KEY_PREFIX)) return source.label;
  return t.profileFields[source.key.slice(PROFILE_KEY_PREFIX.length)] ?? source.label;
}

function SourceLine(props: { group: GeoFactGroup; t: GeoDigestCopy }) {
  const { source } = props.group;
  const href = source.url === null ? null : safeHttpUrl(source.url);
  return (
    <p className="geo-claim__head">
      <strong>
        {source.kind === 'profile' ? props.t.factsProfileSource : props.t.factsPageSource}:
      </strong>{' '}
      <span className="geo-claim__text">{sourceName(props.group, props.t)}</span>
      {href === null ? null : (
        <a className="technical" href={href} target="_blank" rel="noreferrer">
          {href}
        </a>
      )}
    </p>
  );
}

function FactGroup(props: { group: GeoFactGroup; language: Language }) {
  const t = geoDigestCopy[props.language];
  const { group } = props;
  return (
    <li className="geo-claim">
      <SourceLine group={group} t={t} />
      <ul className="geo-evaluation__claims">
        {group.differences.map((difference) => (
          <li className="geo-claim" key={difference.claim}>
            <span className="geo-claim__text">{difference.claim}</span>
            <small className="muted">
              {t.factsProviders}:{' '}
              {difference.providers
                .map((provider) => geoProviderLabel(provider, props.language))
                // Each label already holds " · ", so commas would blur the boundary.
                .join('; ')}
            </small>
            <p className="geo-claim__quote">
              <strong>{t.factsAnswerQuote}:</strong> “{difference.answerQuote}”
            </p>
            <p className="geo-claim__source">
              <strong>{t.factsSiteQuote}:</strong> “{difference.sourceQuote}”
            </p>
          </li>
        ))}
      </ul>
      <p className="muted">
        {group.source.kind === 'profile' ? t.factsProfileAdvice : t.factsPageAdvice}
      </p>
    </li>
  );
}

function FactsBody(props: { facts: GeoFactDigest | null; language: Language }) {
  const t = geoDigestCopy[props.language];
  const { facts } = props;
  if (facts === null || facts.answersChecked === 0) {
    return <p className="muted">{t.factsNotEvaluated}</p>;
  }
  if (facts.groups.length === 0) {
    return <p className="muted">{t.factsNone(facts.answersChecked)}</p>;
  }
  return (
    <>
      <p>{t.factsSummary(facts.differenceCount, facts.answersChecked)}</p>
      <ul className="geo-evaluation__claims">
        {facts.groups.map((group) => (
          <FactGroup key={group.source.key} group={group} language={props.language} />
        ))}
      </ul>
    </>
  );
}

function FactsPart(props: { facts: GeoFactDigest | null; language: Language }) {
  const t = geoDigestCopy[props.language];
  return (
    <section className="geo-digest__part" aria-label={t.factsHeading}>
      <h5 className="module-checks__subheading">{t.factsHeading}</h5>
      <FactsBody facts={props.facts} language={props.language} />
    </section>
  );
}

function ToneRow(props: { tone: GeoProviderTone; language: Language }) {
  const t = geoDigestCopy[props.language];
  const { tone } = props;
  const parts = [
    ...TONE_ORDER.filter((label) => tone.counts[label] > 0).map((label) =>
      t.toneCount(t.toneLabels[label], tone.counts[label]),
    ),
    ...(tone.noDescription > 0 ? [t.toneNoDescription(tone.noDescription)] : []),
    ...(tone.unconfirmed > 0 ? [t.toneUnconfirmed(tone.unconfirmed)] : []),
    ...(tone.notEvaluated > 0 ? [t.toneNotRated(tone.notEvaluated)] : []),
  ];
  return (
    <li>
      <strong>{geoProviderLabel(tone.provider, props.language)}</strong>: {parts.join(' · ')}
    </li>
  );
}

function TonePart(props: { tone: GeoToneDigest | null; language: Language }) {
  const t = geoDigestCopy[props.language];
  const { tone } = props;
  return (
    <section className="geo-digest__part" aria-label={t.toneHeading}>
      <h5 className="module-checks__subheading">{t.toneHeading}</h5>
      {tone === null || !tone.judged ? (
        <p className="muted">{t.toneNotEvaluated}</p>
      ) : (
        <>
          <ul className="module-checks__list">
            {tone.providers.map((summary) => (
              <ToneRow key={summary.provider} tone={summary} language={props.language} />
            ))}
          </ul>
          {tone.negativeQuotes.length === 0 ? (
            <p className="muted">{t.toneNoNegative}</p>
          ) : (
            <>
              <p>
                <strong>{t.toneNegativeHeading}</strong>
              </p>
              <ul className="geo-evaluation__claims">
                {tone.negativeQuotes.map((negative) => (
                  <li className="geo-claim" key={`${negative.provider}:${negative.question}`}>
                    <small className="muted">
                      {geoProviderLabel(negative.provider, props.language)} · {negative.question}
                    </small>
                    <p className="geo-claim__quote">
                      <span className={TONE_BADGE_CLASS.negative}>{t.toneLabels.negative}</span> “
                      {negative.quote}”
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function positionLine(
  summary: GeoProviderPosition,
  competitorsConfigured: boolean,
  language: Language,
): string {
  const t = geoDigestCopy[language];
  if (summary.placedAnswers === 0) return t.positionNotNamed(summary.discoveryAnswers);
  const median =
    summary.medianListRank === null
      ? null
      : summary.medianListRank.toLocaleString(language === 'uk' ? 'uk-UA' : 'en-US');
  return [
    t.positionFirst(summary.firstPlace, summary.placedAnswers),
    ...(summary.inList > 0 ? [t.positionInList(summary.inList, summary.placedAnswers)] : []),
    ...(median === null ? [] : [t.positionMedian(median)]),
    // Without competitors in the profile, "after a competitor" was not measured.
    ...(competitorsConfigured
      ? [t.positionAfterCompetitors(summary.afterCompetitors, summary.placedAnswers)]
      : []),
  ].join('; ');
}

function PositionBody(props: { position: GeoPositionDigest | null; language: Language }) {
  const t = geoDigestCopy[props.language];
  const { position } = props;
  if (position === null) return <p className="muted">{t.positionNotEvaluated}</p>;
  if (position.providers.length === 0) return <p className="muted">{t.positionNoDiscovery}</p>;
  return (
    <>
      <ul className="module-checks__list">
        {position.providers.map((summary) => (
          <li key={summary.provider}>
            <strong>{geoProviderLabel(summary.provider, props.language)}</strong>:{' '}
            {positionLine(summary, position.competitorsConfigured, props.language)}
          </li>
        ))}
      </ul>
      {position.competitorsConfigured ? null : <p className="muted">{t.positionNoCompetitors}</p>}
    </>
  );
}

function PositionPart(props: { position: GeoPositionDigest | null; language: Language }) {
  const t = geoDigestCopy[props.language];
  return (
    <section className="geo-digest__part" aria-label={t.positionHeading}>
      <h5 className="module-checks__subheading">{t.positionHeading}</h5>
      <PositionBody position={props.position} language={props.language} />
    </section>
  );
}

export function GeoDigest(props: { digest: GeoAnswerDigest | null; language: Language }) {
  const t = geoDigestCopy[props.language];
  const { digest } = props;
  return (
    <div className="module-checks__group geo-digest" id="geo-digest">
      <h4 className="module-checks__subheading">{t.heading}</h4>
      <p className="muted">{t.lead}</p>
      {digest === null ? (
        <p className="muted">{t.notEvaluated}</p>
      ) : (
        <>
          <FactsPart facts={digest.facts} language={props.language} />
          <TonePart tone={digest.tone} language={props.language} />
          <PositionPart position={digest.position} language={props.language} />
        </>
      )}
    </div>
  );
}
