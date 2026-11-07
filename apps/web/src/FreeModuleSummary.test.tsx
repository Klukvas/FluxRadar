import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GeoObservation, ScanModule } from './api';
import { FreeModuleSummary } from './FreeModuleSummary';
import { CompleteCheckCatalog } from './CompleteCheckCatalog';
import { completeCatalogCopy } from './complete-catalog-copy';
import { freeReportCopy } from './free-report-copy';
import { copy } from './i18n';

const GEO: ScanModule = {
  module: 'AI SEO / GEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: null,
  applicableChecks: 2,
  completedApplicableChecks: 2,
  usableOutput: true,
  metadata: { freePreview: true, scoring: 'InformationalOnly' },
};
const ANSWER: GeoObservation = {
  purpose: 'closed-book',
  question: 'What is this business?',
  status: 'answered',
  reason: null,
  provider: 'anthropic',
  modelId: 'test-model',
  answer: 'A business.',
  citations: [],
  mentions: { brand: 'mentioned', domain: 'not-mentioned' },
};

afterEach(cleanup);

describe('Free module summaries', () => {
  it.each(['en', 'uk', 'ru'] as const)(
    'names absence of a separate GEO score and explains only an answered preview in %s',
    (language) => {
      const { rerender } = render(
        <FreeModuleSummary module={GEO} observations={[ANSWER]} language={language} />,
      );
      expect(screen.getByText(copy[language].report.informationalLabel)).toBeInTheDocument();
      expect(screen.getByText(freeReportCopy[language].aiExcluded)).toBeInTheDocument();
      rerender(
        <FreeModuleSummary
          module={{
            ...GEO,
            status: 'Not applicable',
            statusReason: 'ConsentMissing',
            usableOutput: false,
          }}
          observations={[]}
          language={language}
        />,
      );
      expect(screen.queryByText(freeReportCopy[language].aiExcluded)).toBeNull();
      expect(screen.getByText(copy[language].report.noScore)).toBeInTheDocument();
    },
  );

  it('does not imply an answer when a provider returned no usable result', () => {
    render(
      <FreeModuleSummary
        module={{ ...GEO, status: 'Unavailable', usableOutput: false }}
        observations={[{ ...ANSWER, status: 'unavailable', answer: null }]}
        language="en"
      />,
    );
    expect(screen.queryByText(freeReportCopy.en.aiExcluded)).toBeNull();
  });

  it('does not attach an upgrade action where the report has no upgrade handler', () => {
    render(<CompleteCheckCatalog modules={[]} language="en" />);
    expect(
      screen.getByRole('region', { name: completeCatalogCopy.en.heading }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps an unknown historical score scale without inventing points or rounding', () => {
    render(
      <FreeModuleSummary
        module={{ ...GEO, module: 'SEO', score: 99, scoreMax: undefined }}
        language="en"
        observations={[]}
      />,
    );
    expect(screen.getByText('99.00')).toBeInTheDocument();
    expect(screen.queryByText(freeReportCopy.en.rounding)).toBeNull();
    expect(screen.queryByText(/Checks in this report/)).toBeNull();
  });
});
