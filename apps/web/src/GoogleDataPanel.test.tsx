import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GoogleDataPanel, googleSnapshotIn } from './GoogleDataPanel';
import type { GoogleDataSnapshot, ScanModule } from './api';
import { copy } from './i18n';

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

describe('googleSnapshotIn', () => {
  it('finds the snapshot the Analytics module stored', () => {
    expect(googleSnapshotIn(moduleWith(POPULATED))).toEqual(POPULATED);
  });

  // Analytics stores its check list and analysis beside the snapshot (D-219).
  it('still finds the snapshot with the Analytics checks stored beside it', () => {
    const stored = { ...POPULATED, ruleChecks: [], analysis: { trend: null } };
    expect(googleSnapshotIn(moduleWith(stored))?.searchConsole).toEqual(POPULATED.searchConsole);
  });

  it('returns null when the module metadata is not a Google snapshot', () => {
    expect(googleSnapshotIn(moduleWith({ standard: 'WCAG 2.2 AA' }))).toBeNull();
  });
});

describe('GoogleDataPanel', () => {
  it('states the source, period and read-only nature of the data', () => {
    render(<GoogleDataPanel snapshot={POPULATED} language="en" />);

    const note = screen.getByText(/Source: Google Search Console/);
    expect(note.textContent).toContain('read-only');
    expect(note.textContent).toContain('2026-08-07');
    expect(note.textContent).toContain('2026-09-03');
    expect(note.textContent).toContain('2026-09-06 09:30');
  });

  it('shows Search Console totals and the top rows', () => {
    render(<GoogleDataPanel snapshot={POPULATED} language="en" />);

    expect(screen.getByText('1,234')).toBeTruthy();
    expect(screen.getByText('56,789')).toBeTruthy();
    expect(screen.getByText('2.2%')).toBeTruthy();
    expect(screen.getByText('12.3')).toBeTruthy();
    expect(screen.getByText('flux radar')).toBeTruthy();
    expect(screen.getByText('https://example.com/pricing')).toBeTruthy();
  });

  it('shows GA4 metrics including the optional key events', () => {
    render(<GoogleDataPanel snapshot={POPULATED} language="en" />);

    expect(screen.getByText('example.com — GA4')).toBeTruthy();
    expect(screen.getByText('4,200')).toBeTruthy();
    expect(screen.getByText('87')).toBeTruthy();
  });

  it('omits key events when the property does not report them', () => {
    const analyticsData = POPULATED.analytics.data;
    if (analyticsData === null) throw new Error('fixture must carry analytics data');
    render(
      <GoogleDataPanel
        language="en"
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
        language="en"
        snapshot={{
          ...BASE,
          searchConsole: {
            state: 'no_property_selected',
            detail: 'No Google property is linked to this profile yet.',
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
        language="en"
        snapshot={{ ...BASE, analytics: { state: 'no_access', detail: 'd', data: null } }}
      />,
    );
    expect(screen.getByText('No access to this property')).toBeTruthy();

    rerender(
      <GoogleDataPanel
        language="en"
        snapshot={{ ...BASE, analytics: { state: 'no_data', detail: 'd', data: null } }}
      />,
    );
    expect(screen.getByText('No data for this period')).toBeTruthy();

    rerender(
      <GoogleDataPanel
        language="en"
        snapshot={{ ...BASE, analytics: { state: 'request_failed', detail: 'd', data: null } }}
      />,
    );
    expect(screen.getByText('Google data unavailable')).toBeTruthy();
  });

  it('never renders a raw HTTP status for a failed request', () => {
    const { container } = render(
      <GoogleDataPanel
        language="en"
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

// Every word on this panel used to be an English literal, so a Ukrainian report
// switched language for one section: "Top queries", "Clicks", "Search Console",
// and the sentence explaining a state with no data — which the API sends in
// English with the snapshot itself.
describe('the Google panel in Ukrainian', () => {
  const uk = copy.uk.report.google;

  it('writes its headings, columns and metric labels in the chosen language', () => {
    render(<GoogleDataPanel snapshot={POPULATED} language="uk" />);

    expect(screen.getByText(uk.topQueries)).toBeTruthy();
    expect(screen.getByText(uk.topPages)).toBeTruthy();
    expect(screen.getAllByText(uk.clicks).length).toBeGreaterThan(0);
    expect(screen.getByText(uk.averagePosition)).toBeTruthy();
    expect(screen.getByText(uk.users)).toBeTruthy();
    // The English literals these replaced must be gone, not merely alongside.
    expect(screen.queryByText('Top queries')).toBeNull();
    expect(screen.queryByText('Average position')).toBeNull();
    expect(screen.queryByText('Page views')).toBeNull();
  });

  it('translates the sentence the API sends in English with the snapshot', () => {
    render(
      <GoogleDataPanel
        language="uk"
        snapshot={{
          ...BASE,
          analytics: {
            state: 'needs_reconnect',
            detail: 'Google access has expired or was revoked. Reconnect Google to continue.',
            data: null,
          },
        }}
      />,
    );

    expect(screen.getByText(uk.stateNeedsReconnect)).toBeTruthy();
    expect(screen.getByText(uk.detailNeedsReconnect)).toBeTruthy();
    expect(screen.queryByText(/Google access has expired/)).toBeNull();
  });

  it('falls back to the API’s own sentence for a state it has no key for', () => {
    render(
      <GoogleDataPanel
        language="uk"
        snapshot={{
          ...BASE,
          analytics: {
            state: 'something_new' as GoogleDataSnapshot['analytics']['state'],
            detail: 'A state this build has never seen.',
            data: null,
          },
        }}
      />,
    );

    // Better the API's words than a blank where an explanation should be.
    expect(screen.getByText('A state this build has never seen.')).toBeTruthy();
  });

  it('reads the source note and the read-only promise in Ukrainian', () => {
    render(<GoogleDataPanel snapshot={POPULATED} language="uk" />);

    const note = screen.getByText(new RegExp(uk.sourceNote.slice(0, 20)));
    expect(note.textContent).toContain('лише читання');
    expect(note.textContent).toContain('2026-08-07');
    expect(screen.queryByText(/Source: Google Search Console/)).toBeNull();
  });
});
