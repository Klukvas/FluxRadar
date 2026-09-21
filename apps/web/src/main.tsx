import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { startAnalytics } from './analytics';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('FluxRadar: #root element is missing in index.html');
}

// Before the first render, so the first screen's page view finds the tag ready
// when the visitor has already allowed analytics.
startAnalytics();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
