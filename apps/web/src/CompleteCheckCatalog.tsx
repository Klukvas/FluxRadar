import type { ScanModule } from './api';
import { Button } from './components';
import { completeCatalogCopy, geoCatalogCapabilities } from './complete-catalog-copy';
import {
  COMPLETE_CATALOG_MODULES,
  completeCatalogChecks,
  recordedCatalogIds,
} from './complete-check-catalog';
import { trackUpgradeClicked } from './funnel-analytics';
import type { Language } from './i18n';
import { moduleLabel } from './rule-titles';
import { reportLanguage } from './report-language';
import type { PaidPlan } from './plan-modules';

import './styles/complete-check-catalog.css';

type CatalogProps = {
  modules: readonly ScanModule[];
  language: Language;
  onUpgrade?: (plan: PaidPlan) => void;
};

export function CompleteCheckCatalog(props: CatalogProps) {
  const t = completeCatalogCopy[props.language];
  const recordedIds = recordedCatalogIds(props.modules);
  return (
    <section className="complete-check-catalog" aria-labelledby="complete-catalog-title">
      <div className="complete-check-catalog__heading">
        <h3 id="complete-catalog-title">{t.heading}</h3>
        {props.onUpgrade === undefined ? null : (
          <Button
            variant="primary"
            onClick={() => {
              trackUpgradeClicked('Complete', 'free_locked_preview');
              props.onUpgrade?.('Complete');
            }}
          >
            {t.upgrade}
          </Button>
        )}
      </div>
      <p>{t.scope}</p>
      <div className="complete-check-catalog__modules">
        {COMPLETE_CATALOG_MODULES.map((module) => {
          const checks = completeCatalogChecks(module, recordedIds, props.language);
          const capabilities =
            module === 'AI SEO / GEO' ? geoCatalogCapabilities[props.language] : [];
          const notes: Readonly<Record<string, string>> = t.notes;
          const labels: Readonly<Record<string, string>> = t.labels;
          const benefits: Readonly<Record<string, string>> = t.benefits;
          return (
            <details
              className="complete-check-catalog__module"
              key={module}
              data-catalog-module={module}
            >
              <summary>
                <span className="complete-check-catalog__summary-copy">
                  <span className="complete-check-catalog__title">
                    {labels[module] ?? moduleLabel(module, props.language)}
                  </span>
                  <span className="complete-check-catalog__benefit">{benefits[module]}</span>
                  <span className="complete-check-catalog__status">
                    <span aria-hidden="true">🔒 </span>
                    {t.available}
                  </span>
                </span>
                <span className="complete-check-catalog__chevron" aria-hidden="true" />
              </summary>
              <p className="complete-check-catalog__note">{notes[module]}</p>
              <ul className="complete-check-catalog__list">
                {checks.map((check) => (
                  <li data-locked-rule={check.id} key={check.id}>
                    <span className="complete-check-catalog__availability">
                      <span aria-hidden="true">🔒 </span>
                      {t.available}
                    </span>
                    <span
                      className="complete-check-catalog__name"
                      lang={reportLanguage(props.language)}
                    >
                      {check.title}
                    </span>
                    <span className="complete-check-catalog__blur" aria-hidden="true" />
                  </li>
                ))}
                {capabilities.map(([id, title]) => (
                  <li data-locked-capability={id} key={id}>
                    <span className="complete-check-catalog__availability">
                      <span aria-hidden="true">🔒 </span>
                      {t.available}
                    </span>
                    <span
                      className="complete-check-catalog__name"
                      lang={reportLanguage(props.language)}
                    >
                      {title}
                    </span>
                    <span className="complete-check-catalog__blur" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}
