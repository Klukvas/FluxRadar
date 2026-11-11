import { useState } from 'react';

import { Button } from './components';
import { copy, type Language } from './i18n';

/**
 * What the site list shows when it could not be read.
 *
 * Not the empty state: an owner told "no sites yet" after a network error adds
 * the same site again. This says the sites are still there and offers the one
 * thing that helps — reading them again.
 */
export function SitesLoadFailed(props: {
  readonly language: Language;
  readonly onRetry: () => Promise<void>;
}) {
  const t = copy[props.language].workspace;
  const [isRetrying, setIsRetrying] = useState(false);
  const retry = async () => {
    setIsRetrying(true);
    try {
      await props.onRetry();
    } finally {
      setIsRetrying(false);
    }
  };
  return (
    <div className="stack">
      <p role="alert">{t.sitesLoadFailed}</p>
      <div className="button-row">
        <Button variant="primary" disabled={isRetrying} onClick={() => void retry()}>
          {t.sitesRetry}
        </Button>
      </div>
    </div>
  );
}
