import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

import { App } from './App';
import { initialPublicRoute } from './app-routes';
import { matchingPublicSnapshot } from './public-page-routing';
import { startAnalytics } from './analytics';
import { rootErrorHandlers, startErrorMonitoring } from './error-monitoring';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('FluxRadar: #root element is missing in index.html');
}

// Before the first render, so the first screen's page view finds the tag ready
// when the visitor has already allowed analytics.
startAnalytics();
// A no-op unless this build was given a Sentry DSN (error-monitoring.ts).
startErrorMonitoring();

const snapshot = matchingPublicSnapshot(
  rootElement.getAttribute('data-public-snapshot'),
  window.location.pathname,
  window.location.search,
  window.location.hash,
);
const app = (
  <StrictMode>
    <App
      {...(snapshot === null
        ? {}
        : { initialRoute: initialPublicRoute(snapshot), initialLanguage: snapshot.language })}
    />
  </StrictMode>
);
if (snapshot === null) {
  rootElement.replaceChildren();
  createRoot(rootElement, rootErrorHandlers()).render(app);
} else hydrateRoot(rootElement, app, rootErrorHandlers());
