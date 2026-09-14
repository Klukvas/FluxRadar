// The Issue Center reads a finding's evidence and recommendation in the
// report's language. Every finding used to carry one stored sentence — written
// in Russian by the rules — which English and Ukrainian readers saw unchanged.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Issue, Scan } from './api';
import type { Language } from './i18n';
import { IssuesScreen } from './Issues';

const SCAN = { id: 'scan-1' } as Scan;

function issueOf(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    scanId: 'scan-1',
    ruleId: 'A11Y-002',
    module: 'Accessibility',
    fingerprint: 'fp-1',
    severity: 'Medium',
    category: 'dom',
    status: 'New',
    targetUrl: 'https://smile.example/',
    evidenceType: 'dom',
    evidenceRef: 'issue/issue-1',
    evidenceExcerpt: 'img.hero has no alt text',
    recommendation: 'Add alt text to meaningful images.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 3,
    rulePenalty: 2,
    scoreDelta: -2,
    observedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

async function openDetails(issue: Issue, language: Language): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: [issue], error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  render(<IssuesScreen scan={SCAN} language={language} onError={() => {}} />);
  const details = await screen.findByRole('button', {
    name: language === 'uk' ? 'Деталі' : 'Details',
  });
  fireEvent.click(details);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a finding’s evidence and recommendation', () => {
  it('are shown in the report language the API rendered', async () => {
    await openDetails(
      issueOf({
        localized: {
          en: {
            evidenceExcerpt: 'img.hero has no alt text',
            recommendation: 'Add alt text to meaningful images.',
          },
          uk: {
            evidenceExcerpt: 'img.hero не має альтернативного тексту',
            recommendation: 'Додайте альтернативний текст до змістовних зображень.',
          },
        },
      }),
      'uk',
    );

    expect(screen.getByText('img.hero не має альтернативного тексту')).toBeInTheDocument();
    expect(
      screen.getByText('Додайте альтернативний текст до змістовних зображень.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Add alt text to meaningful images.')).toBeNull();
  });

  it('fall back to the stored text for a finding without message codes', async () => {
    await openDetails(issueOf({ localized: null }), 'uk');

    expect(screen.getByText('img.hero has no alt text')).toBeInTheDocument();
    expect(screen.getByText('Add alt text to meaningful images.')).toBeInTheDocument();
  });

  it('fall back per field when one language could not be rendered', async () => {
    await openDetails(
      issueOf({
        localized: {
          en: { evidenceExcerpt: null, recommendation: 'Add alt text to meaningful images.' },
          uk: { evidenceExcerpt: null, recommendation: null },
        },
      }),
      'uk',
    );

    expect(screen.getByText('img.hero has no alt text')).toBeInTheDocument();
    expect(screen.getByText('Add alt text to meaningful images.')).toBeInTheDocument();
  });
});
