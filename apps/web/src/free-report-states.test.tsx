import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GeoObservation, Scan, ScanModule } from './api';
import { FreeAiPreview } from './FreeAiPreview';
import { FreeModuleSummary } from './FreeModuleSummary';
import { FreeScore } from './FreeScore';
import { FreeUpsell } from './FreeUpsell';
import { findingsCopy } from './findings-copy';
import { freePreviewCopy } from './free-preview-copy';
import { freeReportCopy } from './free-report-copy';
import { freeScoreCopy } from './free-score-copy';

afterEach(cleanup);

const SEO: ScanModule = {
  module: 'SEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 39.6,
  scoreMax: 40,
  applicableChecks: 6,
  completedApplicableChecks: 6,
  usableOutput: true,
  metadata: {
    ruleChecks: Array.from({ length: 6 }, (_, index) => ({
      ruleId: `check-${index}`,
      title: `Check ${index}`,
      targetKind: 'page',
      applicableTargets: 1,
      affectedTargets: index === 5 ? 1 : 0,
    })),
  },
};

describe.each(['en', 'uk', 'ru'] as const)('Free report truthfulness in %s', (language) => {
  it.each([
    ['Not applicable', 'ConsentMissing', 'notRunConsent'],
    ['Running', null, 'pending'],
    ['Unavailable', null, 'notRunOther'],
  ] as const)(
    'shows only the actual %s AI state without claiming an answer',
    (status, statusReason, key) => {
      render(
        <FreeAiPreview
          modules={[{ ...SEO, module: 'AI SEO / GEO', status, statusReason }]}
          observations={[]}
          evidence={null}
          language={language}
        />,
      );
      expect(screen.getByRole('note')).toHaveTextContent(freePreviewCopy[language].preview[key]);
      expect(screen.queryByText(freePreviewCopy[language].preview.answerLead(null))).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it.each(['', ' \n\t  '])('does not claim an answer for empty model text %j', (answer) => {
    const module = { ...SEO, module: 'AI SEO / GEO' };
    const observation: GeoObservation = {
      purpose: 'closed-book',
      question: 'Business?',
      status: 'answered',
      reason: null,
      provider: 'anthropic',
      modelId: 'test-model',
      answer,
      citations: [],
      mentions: null,
    };
    render(
      <>
        <FreeAiPreview
          modules={[module]}
          observations={[observation]}
          evidence={null}
          language={language}
        />
        <FreeModuleSummary module={module} observations={[observation]} language={language} />
      </>,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      freePreviewCopy[language].preview.notRunOther,
    );
    expect(screen.queryByText(freePreviewCopy[language].preview.answerLead(null))).toBeNull();
    expect(screen.queryByText(freeReportCopy[language].aiExcluded)).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('keeps 39.6 rounded to 40 while showing one affected check beside both score surfaces', () => {
    render(
      <>
        <FreeScore
          overall={{
            score: 39.6,
            scoreMax: 40,
            verdict: 'normal',
            weightedCoverage: 1,
            moduleWeights: [],
          }}
          modules={[SEO]}
          language={language}
        />
        <FreeModuleSummary module={SEO} observations={[]} language={language} />
      </>,
    );
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getAllByText(freeReportCopy[language].issueChecks(1))).toHaveLength(2);
    expect(screen.getAllByText(freeReportCopy[language].rounding)).toHaveLength(2);
    expect(screen.getByText(freeReportCopy[language].checks(6))).toBeInTheDocument();
    expect(screen.getByText(freeScoreCopy[language].capDisclosure(6))).toBeInTheDocument();
  });

  it('offers Basic separately and explains the actual $48 Complete difference', () => {
    const onUpgrade = vi.fn();
    const t = findingsCopy[language].upsell;
    render(
      <FreeUpsell
        scan={{ domain: 'https://example.test' } as Scan}
        language={language}
        openProblems={1}
        onUpgrade={onUpgrade}
      />,
    );
    expect(screen.getByText(t.basic)).toHaveTextContent('$39');
    expect(screen.getByText(t.difference)).toHaveTextContent('$48');
    expect(screen.getByText(t.difference)).toHaveTextContent('SEO');
    fireEvent.click(screen.getByRole('button', { name: t.basicAction }));
    expect(onUpgrade).toHaveBeenLastCalledWith('Basic');
    fireEvent.click(screen.getByRole('button', { name: t.action }));
    expect(onUpgrade).toHaveBeenLastCalledWith('Complete');
  });
});

it('does not invent zero issues for a historical report without saved check outcomes', () => {
  render(
    <FreeScore
      overall={{
        score: 40,
        scoreMax: 40,
        verdict: 'normal',
        weightedCoverage: 1,
        moduleWeights: [],
      }}
      modules={[{ ...SEO, metadata: { checks: [{ ruleId: 'old', title: 'Old check' }] } }]}
      language="en"
    />,
  );
  expect(screen.queryByText(/Checks with issues:/)).toBeNull();
});
