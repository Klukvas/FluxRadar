import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FreeScore } from './FreeScore';
import { HomeHero } from './HomeHero';
import { ScoreDial } from './components';
import type { Dashboard, ScanModule } from './api';
import { freeReportCopy } from './free-report-copy';
import { freeScoreCopy } from './free-score-copy';
import { trackUpgradeClicked } from './funnel-analytics';
import { copy, type Language } from './i18n';
import { BASIC_PRICE, COMPLETE_PRICE } from './tariff-prices';

vi.mock('./funnel-analytics', () => ({ trackUpgradeClicked: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const languages: readonly Language[] = ['en', 'uk', 'ru'];
const checks = Array.from({ length: 6 }, (_, index) => ({
  ruleId: `SEO-${index}`,
  title: `Check ${index}`,
  applicableTargets: 1,
  affectedTargets: index === 0 ? 1 : 0,
  scoring: 'scored',
}));
const seo: ScanModule = {
  module: 'SEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 39.6,
  scoreMax: 40,
  applicableChecks: 6,
  completedApplicableChecks: 6,
  usableOutput: true,
  metadata: { ruleChecks: checks },
};
const overall: Dashboard['overall'] = {
  score: 39.6,
  scoreMax: 40,
  verdict: 'normal',
  weightedCoverage: 1,
  moduleWeights: [],
};

describe('HOME states the offer before a click', () => {
  it.each(languages)(
    'shows Free scope, registration, no card and optional one-time prices (%s)',
    (language) => {
      const start = vi.fn();
      render(<HomeHero language={language} onStartSite={start} onSeePricing={vi.fn()} />);
      const input = screen.getByRole('textbox');
      const note = document.getElementById(input.getAttribute('aria-describedby') ?? '');
      expect(note).toHaveTextContent(/Free: 6/);
      expect(note).toHaveTextContent(/homepage|головної сторінки|главной страницы/);
      expect(note).toHaveTextContent(/after registration|після реєстрації|после регистрации/);
      expect(note).toHaveTextContent(/No card needed|Картка не потрібна|Карта не нужна/);
      expect(note).toHaveTextContent(/optional|за бажанням|по желанию/);
      expect(note).toHaveTextContent(`Basic ${BASIC_PRICE}`);
      expect(note).toHaveTextContent(`Complete ${COMPLETE_PRICE}`);
      expect(note).toHaveTextContent(/each a one-time|кожен з разовою|каждый с разовой/);
      expect(note).not.toHaveTextContent(/\{.*\}/);
      expect(start).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: 'not a site' } });
      fireEvent.click(screen.getByRole('button'));
      const error = screen.getByRole('alert');
      expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual([note?.id, error.id]);
      expect(note).toHaveTextContent(`Complete ${COMPLETE_PRICE}`);
      expect(start).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: 'mysalon.com' } });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(input.getAttribute('aria-describedby')).toBe(note?.id);
    },
  );

  it.each(languages)('keeps both example presentations accurate (%s)', (language) => {
    const home = copy[language].home;
    const heroText = home.hero.example.findings.map((finding) => finding.problem).join(' ');
    const fullText = home.example.findings.map((finding) => finding.title).join(' ');
    for (const text of [heroText, fullText]) {
      expect(text).not.toMatch(
        /random|випадков|случайн|cannot tell|не знає|не знает|не знають|не знают/,
      );
      expect(text).toMatch(/may use page content|може взяти.*вмісту|может взять.*содержимого/);
      expect(text).toMatch(/helps? search engines|допомагає пошуковикам|помогает поисковикам/);
      expect(text).toMatch(/screen readers|читання екрана|чтения экрана/);
    }
    expect(fullText).toMatch(/even when.*description|навіть коли опис є|даже когда описание есть/);
    expect(home.example.findings.at(-1)?.action).toMatch(
      /decoration.*empty|оздобою.*порожній|украшением.*пустое/,
    );
  });
});

describe('Free score separates points, findings and execution', () => {
  it('leaves paid score rendering and coverage unchanged', () => {
    const { container } = render(
      <ScoreDial language="en" score={87.5} verdict="normal" coverage={1} />,
    );
    expect(screen.getByText('87.50')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(container.querySelector('.free-score__context')).toBeNull();
    expect(screen.getByText('100% of the checks were done')).toBeInTheDocument();
  });

  it.each(languages)(
    'groups the saved issue count with a rounded maximum before status and upgrades (%s)',
    (language) => {
      const onUpgrade = vi.fn();
      const { container } = render(
        <FreeScore language={language} overall={overall} modules={[seo]} onUpgrade={onUpgrade} />,
      );
      const meter = screen.getByRole('meter');
      expect(meter).toHaveTextContent('40 / 40');
      expect(meter).toHaveAttribute('aria-valuemax', '40');
      const dial = meter.closest('.score-dial') as HTMLElement;
      const issues = within(dial).getByText(freeReportCopy[language].issueChecks(1));
      expect(within(dial).getByText(freeReportCopy[language].completion(6, 6))).toBeInTheDocument();
      expect(within(dial).getByText(freeReportCopy[language].rounding)).toBeInTheDocument();
      expect(
        issues.compareDocumentPosition(dial.querySelector('.status-chip') as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(container.querySelector('.free-score > .free-score__issues')).toBeNull();
      const complete = screen.getByRole('button', { name: freeScoreCopy[language].upgrade(100) });
      expect(complete).toHaveClass('button--primary');
      expect(complete).toHaveTextContent(`Complete · ${COMPLETE_PRICE}`);
      expect(complete).toHaveTextContent(/one-time|разово/);
      const basic = screen.getByRole('button', {
        name: freeReportCopy[language].basicAction(BASIC_PRICE),
      });
      expect(basic).toHaveTextContent(/one-time|разово/);
      fireEvent.click(complete);
      fireEvent.click(basic);
      expect(onUpgrade.mock.calls).toEqual([['Complete'], ['Basic']]);
      expect(vi.mocked(trackUpgradeClicked).mock.calls).toEqual([
        ['Complete', 'free_score'],
        ['Basic', 'free_score'],
      ]);
    },
  );

  it('shows zero only when the saved checks actually found no issues', () => {
    render(
      <FreeScore
        language="en"
        overall={overall}
        modules={[
          {
            ...seo,
            metadata: { ruleChecks: checks.map((check) => ({ ...check, affectedTargets: 0 })) },
          },
        ]}
      />,
    );
    expect(screen.getByText('Checks with issues: 0')).toBeInTheDocument();
  });

  it.each([
    ['legacy names', { ...seo, metadata: { checks: ['Title'] } }],
    ['unknown results', { ...seo, metadata: {} }],
    ['incomplete saved results', { ...seo, metadata: { ruleChecks: checks.slice(1) } }],
    ['malformed partial results', { ...seo, metadata: { ruleChecks: [...checks, {}] } }],
    [
      'skipped',
      {
        ...seo,
        status: 'Skipped',
        usableOutput: false,
        applicableChecks: null,
        completedApplicableChecks: null,
      },
    ],
    ['unavailable', { ...seo, status: 'Unavailable', usableOutput: false }],
  ] as const)('does not invent a clean result for %s', (_name, module) => {
    render(<FreeScore language="en" overall={{ ...overall, score: null }} modules={[module]} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText(freeReportCopy.en.issueResultsUnknown)).toBeInTheDocument();
    expect(screen.queryByText('Checks with issues: 0')).toBeNull();
    expect(screen.queryByText(freeReportCopy.en.rounding)).toBeNull();
  });

  it('keeps an older unknown score scale without inventing a denominator or upgrades', () => {
    render(
      <FreeScore
        language="en"
        overall={{ ...overall, score: 87.5, scoreMax: undefined }}
        modules={[seo]}
        onUpgrade={vi.fn()}
      />,
    );
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('87.50')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(freeReportCopy.en.rounding)).toBeNull();
  });
});
