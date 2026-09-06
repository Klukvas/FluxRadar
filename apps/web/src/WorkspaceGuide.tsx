import { copy, type Language } from './i18n';

// A plain-language map of the signed-in workspace. It mirrors the main
// navigation (Files → Scan → Reports, plus Integrations and Plans) so a
// non-technical owner can tell what each tab is for without relying on the
// one-time tour or on hover-only tooltips. Rendered as a definition list so
// assistive technology reads each area name with its description.
export function WorkspaceGuide(props: { language: Language }) {
  const t = copy[props.language];
  const areas: readonly { key: string; term: string; description: string }[] = [
    { key: 'files', term: t.nav.files, description: t.nav.descriptions.files },
    { key: 'scan', term: t.nav.scan, description: t.nav.descriptions.scan },
    { key: 'reports', term: t.nav.reports, description: t.nav.descriptions.reports },
    {
      key: 'integrations',
      term: t.nav.integrations,
      description: t.nav.descriptions.integrations,
    },
    { key: 'plans', term: t.nav.plans, description: t.nav.descriptions.plans },
  ];
  return (
    <section className="workspace-guide" aria-labelledby="workspace-guide-title">
      <div className="workspace-guide__head">
        <h2 id="workspace-guide-title" className="section-heading">
          {t.workspace.guideTitle}
        </h2>
        <p className="muted">{t.workspace.guideLead}</p>
      </div>
      <dl className="workspace-guide__list">
        {areas.map((area) => (
          <div className="workspace-guide__item" key={area.key}>
            <dt>{area.term}</dt>
            <dd>{area.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
