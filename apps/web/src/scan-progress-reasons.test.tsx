// The reason a section ended where it did, on the scan progress window.
//
// "Analytics · Unavailable" was followed by a separate "Why" block under the
// row, which read as a new, unlabelled row between Analytics and Accessibility.
// The reason now sits in the same row, right after the status word.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Scan, ScanModule } from './api';
import { moduleStatusReasons } from './module-status';
import { ScanScreen } from './ScanProgress';

const ANALYTICS: ScanModule = {
  module: 'Analytics',
  status: 'Unavailable',
  statusReason: 'AnalyticsPropertyNotSelected',
  coverage: null,
  score: null,
  applicableChecks: 1,
  completedApplicableChecks: 0,
  usableOutput: false,
  metadata: {},
};

const SECURITY: ScanModule = {
  ...ANALYTICS,
  module: 'Security',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 96,
  usableOutput: true,
};

const SCAN: Scan = {
  id: 'scan-1',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://flux-lab.dev',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 2, totalModules: 2 },
  startedAt: '2026-09-14T00:00:00.000Z',
  completedAt: '2026-09-14T00:01:00.000Z',
  createdAt: '2026-09-14T00:00:00.000Z',
  modules: [SECURITY, ANALYTICS],
};

afterEach(cleanup);

function renderProgress(): void {
  render(
    <ScanScreen
      scan={SCAN}
      language="en"
      onUpdate={() => {}}
      onDone={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
}

/** The progress row by its section name. */
function row(name: string): HTMLElement {
  return screen.getByText(name).closest('.field-row') as HTMLElement;
}

describe('a section reason on the progress window', () => {
  it('follows the status word in the same row', () => {
    const [reason] = moduleStatusReasons(ANALYTICS, 'en');
    expect(reason).toBeDefined();
    renderProgress();

    expect(row('Analytics')).toHaveTextContent(reason as string);
    expect(screen.queryByText('Why')).toBeNull();
  });

  it('adds nothing to a section that simply finished', () => {
    renderProgress();

    expect(row('Security').querySelector('.section-status__reason')).toBeNull();
  });
});
