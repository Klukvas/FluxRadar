// Search queries an AI model suggests the site might be missing.
//
// It sits below the Search Console tables and never inside them. Every decision
// here is about keeping that separation legible: its own region with its own
// heading, a badge on the heading saying what the rows are, no column that could
// be mistaken for a measurement, and a language column — because a Ukrainian
// idea in an English table would otherwise read as a stray row.
//
// It is generated on request rather than on open. Asking costs money and sends
// the measured queries above to the AI provider, so the reader presses a button
// and is told beforehand what pressing it does.

import { useState } from 'react';

import { apiRequest, type QueryIdea, type QueryIdeaLanguage, type QueryIdeasResult } from './api';
import { Button } from './components';
import { copy, fillCopy, type Language } from './i18n';

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'generating' }
  | { readonly kind: 'answered'; readonly result: QueryIdeasResult };

/** The order the three languages are listed in, whatever order the model used. */
const LANGUAGE_ORDER: readonly QueryIdeaLanguage[] = ['ru', 'uk', 'en'];

function languageLabel(language: QueryIdeaLanguage, ui: Language): string {
  const t = copy[ui].report.queryIdeas;
  if (language === 'ru') return t.languageRu;
  if (language === 'uk') return t.languageUk;
  return t.languageEn;
}

function sortByLanguage(ideas: readonly QueryIdea[]): readonly QueryIdea[] {
  return [...ideas].sort(
    (one, other) => LANGUAGE_ORDER.indexOf(one.language) - LANGUAGE_ORDER.indexOf(other.language),
  );
}

/** A generated timestamp the reader can place, or the raw value if it is not one. */
function formatGeneratedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().replace('T', ' ').slice(0, 16);
}

export function QueryIdeasPanel(props: { scanId: string; language: Language }) {
  const t = copy[props.language].report.queryIdeas;
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const generate = async (): Promise<void> => {
    setPhase({ kind: 'generating' });
    try {
      const result = await apiRequest<QueryIdeasResult>(
        `/scans/${props.scanId}/search-console/query-ideas`,
        { method: 'POST', body: JSON.stringify({ noticeVersion: 'query-ideas-v2' }) },
      );
      setPhase({ kind: 'answered', result });
    } catch {
      // Any failure is the same fact for the reader: no ideas came back and
      // nothing on the report changed. The API already refuses to hand over a
      // provider message, and a rate-limit or network error is no more
      // actionable here than a model that declined.
      setPhase({ kind: 'answered', result: { state: 'failed' } });
    }
  };

  return (
    <section className="query-ideas" aria-labelledby="query-ideas-title">
      <h4 className="section-heading query-ideas__heading" id="query-ideas-title">
        {t.heading}
        <span className="query-ideas__badge">{t.badge}</span>
      </h4>
      <p className="muted query-ideas__lead">{t.lead}</p>
      <QueryIdeasBody phase={phase} language={props.language} />
      <p className="muted query-ideas__note">{t.idleBody}</p>
      <div className="button-row query-ideas__actions">
        <Button onClick={() => void generate()} disabled={phase.kind === 'generating'}>
          {phase.kind === 'generating'
            ? t.generating
            : phase.kind === 'idle'
              ? t.generate
              : t.regenerate}
        </Button>
      </div>
    </section>
  );
}

function QueryIdeasBody({ phase, language }: { phase: Phase; language: Language }) {
  const t = copy[language].report.queryIdeas;
  if (phase.kind === 'idle') {
    return null;
  }
  if (phase.kind === 'generating') {
    return (
      <p className="muted query-ideas__note" role="status">
        {t.generating}
      </p>
    );
  }
  const result = phase.result;
  if (result.state === 'generated') {
    return (
      <IdeasTable
        ideas={result.ideas}
        model={result.model}
        generatedAt={result.generatedAt}
        language={language}
      />
    );
  }
  const [title, body] =
    result.state === 'not_configured'
      ? [t.notConfiguredTitle, t.notConfiguredBody]
      : result.state === 'unavailable'
        ? [t.unavailableTitle, t.unavailableBody]
        : result.state === 'empty'
          ? [t.emptyTitle, t.emptyBody]
          : [t.failedTitle, t.failedBody];
  return (
    <div className="query-ideas__unavailable" role="status">
      <strong>{title}</strong>
      <p className="muted">{body}</p>
    </div>
  );
}

function IdeasTable(props: {
  ideas: readonly QueryIdea[];
  model: string;
  generatedAt: string;
  language: Language;
}) {
  const t = copy[props.language].report.queryIdeas;
  return (
    <>
      <table className="google-panel__table query-ideas__table">
        <caption>{t.tableLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{t.columnQuery}</th>
            <th scope="col">{t.columnLanguage}</th>
            <th scope="col">{t.columnRationale}</th>
          </tr>
        </thead>
        <tbody>
          {sortByLanguage(props.ideas).map((idea) => (
            <tr key={`${idea.language}:${idea.query}`}>
              <td>{idea.query}</td>
              <td>{languageLabel(idea.language, props.language)}</td>
              <td>{idea.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted query-ideas__note">
        {fillCopy(t.generatedNote, {
          model: props.model,
          time: formatGeneratedAt(props.generatedAt),
        })}
      </p>
    </>
  );
}
