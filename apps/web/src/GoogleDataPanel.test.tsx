import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GoogleDataPanel, googleSnapshotOf } from './GoogleDataPanel';
import type { GoogleDataSnapshot, ScanModule } from './api';

afterEach(cleanup);

const BASE: GoogleDataSnapshot = {
  source: 'google',
  readOnly: true,
  fetchedAt: '2026-09-06T09:30:00.000Z',
  dateRange: { startDate: '2026-08-07', endDate: '2026-09-03' },
  searchConsole: { state: 'not_connected', detail: 'Google is not connected.', data: null },
  analytics: { state: 'not_connected', detail: 'Google is not connected.', data: null },
};

const POPULATED: GoogleDataSnapshot = {
  ...BASE,
  searchConsole: {
    state: 'connected',
    detail: 'ok',
    data: {
      siteUrl: 'sc-domain:example.com',
      totals: { clicks: 1234, impressions: 56789, ctr: 0.0217, position: 12.34 },
      topQueries: [
        { key: 'flux radar', clicks: 300, impressions: 4000, ctr: 0.075, position: 3.2 },
      ],
      topPages: [
        {
          key: 'https://example.com/pricing',
          clicks: 200,
          impressions: 900,
          ctr: 0.22,
          position: 5,
        },
      ],
    },
  },
  analytics: {
    state: 'connected',
    detail: 'ok',
    data: {
      propertyId: '123456',
      propertyName: 'example.com — GA4',
      users: 4200,
      sessions: 5100,
      pageViews: 15300,
      events: 40100,
      keyEvents: 87,
    },
  },
};

function moduleWith(metadata: unknown): ScanModule {
  return {
    module: 'Analytics',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: null,
    applicableChecks: 2,
    completedApplicableChecks: 2,
    usableOutput: true,
    metadata: metadata as Record<string, unknown>,
  };
}

describe('googleSnapshotOf', () => {
  it('finds the snapshot the Analytics module stored', () => {
    expect(googleSnapshotOf([moduleWith(POPULATED)])).toEqual(POPULATED);
  });

  it('returns null for a plan without the Analytics module', () => {
    expect(googleSnapshotOf([{ ...moduleWith(POPULATED), module: 'SEO' }])).toBeNull();
  });

  it('returns null when the module metadata is not a Google snapshot', () => {
    expect(googleSnapshotOf([moduleWith({ standard: 'WCAG 2.2 AA' })])).toBeNull();
  });
});

describe('GoogleDataPanel', () => {
  it('states the source, period and read-only nature of the data', () => {
    render(<GoogleDataPanel snapshot={POPULATED} />);

    const note = screen.getByText(/Source: Google Search Console/);
    expect(note.textContent).toContain('read-only');
    expect(note.textContent).toContain('2026-08-07');
    expect(note.textContent).toContain('2026-09-03');
    expect(note.textContent).toContain('2026-09-06 09:30');
  });

  it('shows Search Console totals and the top rows', () => {
    render(<GoogleDataPanel snapshot={POPULATED} />);

    expect(screen.getByText('1,234')).toBeTruthy();
    expect(screen.getByText('56,789')).toBeTruthy();
    expect(screen.getByText('2.2%')).toBeTruthy();
    expect(screen.getByText('12.3')).toBeTruthy();
    expect(screen.getByText('flux radar')).toBeTruthy();
    expect(screen.getByText('https://example.com/pricing')).toBeTruthy();
  });

  it('shows GA4 metrics including the optional key events', () => {
    render(<GoogleDataPanel snapshot={POPULATED} />);

    expect(screen.getByText('example.com — GA4')).toBeTruthy();
    expect(screen.getByText('4,200')).toBeTruthy();
    expect(screen.getByText('87')).toBeTruthy();
  });

  it('omits key events when the property does not report them', () => {
    const analyticsData = POPULATED.analytics.data;
    if (analyticsData === null) throw new Error('fixture must carry analytics data');
    render(
      <GoogleDataPanel
        snapshot={{
          ...POPULATED,
          analytics: { ...POPULATED.analytics, data: { ...analyticsData, keyEvents: null } },
        }}
      />,
    );

    expect(screen.queryByText('Key events')).toBeNull();
  });

  it('explains a missing property instead of showing zeros', () => {
    render(
      <GoogleDataPanel
        snapshot={{
          ...BASE,
          searchConsole: {
            state: 'no_property_selected',
            detail: 'No Google property is linked to this website yet.',
            data: null,
          },
        }}
      />,
    );

    expect(screen.getByText('No property linked')).toBeTruthy();
    expect(screen.queryByText('Clicks')).toBeNull();
  });

  it('distinguishes no access, no data and a failed request', () => {
    const { rerender } = render(
      <GoogleDataPanel
        snapshot={{ ...BASE, analytics: { state: 'no_access', detail: 'd', data: null } }}
      />,
    );
    expect(screen.getByText('No access to this property')).toBeTruthy();

    rerender(
      <GoogleDataPanel
        snapshot={{ ...BASE, analytics: { state: 'no_data', detail: 'd', data: null } }}
      />,
    );
    expect(screen.getByText('No data for this period')).toBeTruthy();

    rerender(
      <GoogleDataPanel
        snapshot={{ ...BASE, analytics: { state: 'request_failed', detail: 'd', data: null } }}
      />,
    );
    expect(screen.getByText('Google data unavailable')).toBeTruthy();
  });

  it('never renders a raw HTTP status for a failed request', () => {
    const { container } = render(
      <GoogleDataPanel
        snapshot={{
          ...BASE,
          analytics: {
            state: 'request_failed',
            detail: 'Google did not respond in time. The rest of the report is unaffected.',
            data: null,
          },
        }}
      />,
    );

    expect(container.textContent).not.toMatch(/\b(404|500|503|HTTP)\b/);
  });
});
