import { auditMethodologyCopy } from './audit-methodology-copy';
import type { Language } from './i18n';
import { publicPagePath } from './public-page-routing';

export function AuditMethodology({ language }: { readonly language: Language }) {
  const t = auditMethodologyCopy[language];
  return (
    <section id="methodology" className="legal-section">
      <h2>{t.heading}</h2>
      <p>{t.whatItIs}</p>
      <p>{t.scope}</p>
      <p>{t.limits}</p>
      <p>{t.plans}</p>
      <ul>
        <li>
          <a href={publicPagePath('exampleReport', language)}>{t.exampleLink}</a>
        </li>
        <li>
          <a href="/knowledge-base/pokryttia-ta-bal">{t.coverageLink}</a>
        </li>
        <li>
          <a href="/knowledge-base/ai-kraulery">{t.aiAccessLink}</a>
        </li>
        <li>
          <a href="/blog/uk/fluxradar-html-bez-javascript">{t.caseLink}</a>
        </li>
      </ul>
      <p>
        {t.questions}
        <a href="mailto:support@fluxradar.net">support@fluxradar.net</a>.{' '}
        <a href={publicPagePath('privacy', language)}>{t.operatorLink}</a>.
      </p>
    </section>
  );
}
