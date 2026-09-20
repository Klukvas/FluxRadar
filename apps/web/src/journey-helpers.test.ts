// Small decisions the journey rests on: which next step the desktop offers,
// and what an exported file is called.

import { describe, expect, it } from 'vitest';

import type { Scan, SiteProfile } from './api';
import { nextStepFor } from './DesktopScreen';
import { exportBaseName } from './Report';

const profile = { id: 'p1', name: 'Shop', domain: 'https://shop.example.com' } as SiteProfile;

function scan(overrides: Partial<Scan>): Scan {
  return {
    id: 's1',
    profileId: 'p1',
    plan: 'Free',
    domain: 'https://shop.example.com',
    status: 'Completed',
    createdAt: '2026-09-18T09:00:00.000Z',
    completedAt: '2026-09-18T09:01:00.000Z',
    ...overrides,
  } as Scan;
}

describe('the next step on the desktop', () => {
  it.each([
    ['no site yet', [], null, 'noProfiles'],
    ['a site, never checked', [profile], null, 'noScans'],
    ['a scan still running', [profile], scan({ status: 'Running', completedAt: null }), 'running'],
    ['a failed scan', [profile], scan({ status: 'Failed' }), 'failed'],
    ['a free check done', [profile], scan({ plan: 'Free' }), 'freeDone'],
    ['a paid report done', [profile], scan({ plan: 'Complete' }), 'paidDone'],
    // Partial is terminal, but a section came back incomplete and may run once more.
    [
      'a partial report with its retry unused',
      [profile],
      scan({ plan: 'Complete', status: 'Partial', retry: { platform: 0, module: 0 } }),
      'partial',
    ],
    [
      'a partial report whose retry is spent',
      [profile],
      scan({ plan: 'Complete', status: 'Partial', retry: { platform: 0, module: 1 } }),
      'paidDone',
    ],
  ] as const)('%s → %s', (_label, profiles, latest, expected) => {
    expect(nextStepFor(profiles, latest)).toBe(expected);
  });
});

describe('export file names', () => {
  it('name the site and the day of the scan, not the database id', () => {
    expect(exportBaseName(scan({}))).toBe('fluxradar-shop.example.com-2026-09-18');
    expect(exportBaseName(scan({ completedAt: null }))).toBe(
      'fluxradar-shop.example.com-2026-09-18',
    );
  });
});
