// What a Russian interface sends to an API that speaks two languages.
//
// Three API fields name the language something will be *written* in: the PDF's
// `?language=`, the support message's `language`, and the profile suggestion's
// `targetLanguage`. All three are enums of `en | uk` on the server, because a
// report, a PDF and an email exist in those two languages only. A Russian
// interface must map onto Ukrainian at each of them rather than send `ru` and
// get a 400 back (see `report-language.ts`).
//
// One field is the exception: the language handed to Google sign-in is written
// nowhere. It is echoed back on the redirect to pick the interface language, so
// the API accepts every interface language there, `ru` included.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResultsScreen } from './Report';
import { SupportWidget } from './SupportWidget';
import type { ActionPlanState, IssueRuleGroup, IssueSummary, Scan } from './api';
import { actionPlanCopy } from './action-plan-copy';
import { reportLanguage } from './report-language';
import { LANGUAGES, languageOptions, readLanguageParam } from './i18n';

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(handler: (path: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(new URL(String(input)).pathname, init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const PAID_SCAN = {
  id: 'scan-plan-hint',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://salon.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-10-01T00:00:00.000Z',
  completedAt: '2026-10-01T00:01:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  modules: [],
} as Scan;

/** One open rule outside Analytics, so the plan block has something to plan. */
const OPEN_SUMMARY: IssueSummary = {
  total: 2,
  open: 2,
  bySeverity: {},
  groups: [
    { ruleId: 'SEO-ONPAGE-001', module: 'SEO', severity: 'High', issues: 2, openIssues: 2 },
  ] as IssueRuleGroup[],
};

/** No plan written yet, and the three-day window still open. */
const IDLE_PLAN: ActionPlanState = {
  scanId: PAID_SCAN.id,
  languages: [],
  running: null,
  lastFailure: null,
  remaining: { successes: 3, attempts: 6 },
  windowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
  plan: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the language a Russian interface asks the API for', () => {
  it('never sends an interface language where a report language is expected', () => {
    // The mapping itself, for every language the switcher offers: whatever a
    // reader picks, the value that reaches a report enum is in that enum.
    for (const language of LANGUAGES) {
      expect(['en', 'uk']).toContain(reportLanguage(language));
    }
  });

  it('asks for the Ukrainian PDF from a Russian report screen', () => {
    // The address `Report.tsx` builds. Read as source rather than rendered:
    // the download needs a whole report fixture, and what is being pinned is
    // the one query parameter.
    const source = readFileSync(resolve(process.cwd(), 'src/Report.tsx'), 'utf8');
    expect(source).toContain('report.pdf?language=${reportLanguage(props.language)}');
    expect(source).not.toContain('report.pdf?language=${props.language}');
  });

  it('asks for a Ukrainian profile suggestion from a Russian form', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/use-profile-autofill.ts'), 'utf8');
    expect(source).toContain('targetLanguage: reportLanguage(languageAtSubmit)');
    expect(source).not.toContain('targetLanguage: languageAtSubmit');
  });

  it('sends uk when a Russian reader writes to support', async () => {
    const fetchMock = stubApi((path) =>
      path === '/support/status' ? envelope({ available: true }) : envelope({ status: 'sent' }),
    );

    render(<SupportWidget language="ru" accountEmail="owner@example.com" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Обратиться в поддержку' }));
    const dialog = screen.getByRole('dialog', { name: 'Обратиться в поддержку' });
    fireEvent.change(screen.getByLabelText('Тема'), { target: { value: 'Отчёт не открывается' } });
    fireEvent.change(screen.getByLabelText('Сообщение'), {
      target: { value: 'Отчёт не открывается на телефоне, страница остаётся пустой.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(screen.getByText('Сообщение отправлено')).toBeInTheDocument());
    const sent = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as { language: string });
    expect(sent).toHaveLength(1);
    // The support reply is an email, so it is written in Ukrainian; sending
    // `ru` here is what the API's `z.enum(['en','uk'])` would refuse.
    expect(sent[0]?.language).toBe('uk');
    expect(dialog).toBeTruthy();
  });

  // The one field that is purely a UI selection, so the API was extended for it
  // rather than mapped. The enum lives in apps/api/src/auth/google-routes.ts
  // and is read here as text, because apps/web cannot import the API.
  it('may send ru to Google sign-in, which only picks the interface language', () => {
    const routes = readFileSync(resolve(process.cwd(), '../api/src/auth/google-routes.ts'), 'utf8');
    const list = /const SIGN_IN_LANGUAGES = \[([^\]]*)\] as const;/.exec(routes)?.[1] ?? '';
    const accepted = Array.from(list.matchAll(/'([a-z]{2})'/g), (match) => match[1]);
    expect(accepted.sort()).toEqual([...LANGUAGES].sort() as string[]);
    expect(routes).toContain('z.enum(SIGN_IN_LANGUAGES)');
  });

  // The Action Plan is the other field a reader may set to Russian, and there
  // the API already offers thirty languages: `ru` is accepted, and a Russian
  // reader who asks for a Russian plan gets one. What the picker *defaults* to
  // is the report's language, because the PDF embeds the plan written in that
  // language and nothing else (apps/api/src/export/pdf/plan-section.ts) — a
  // Russian default left the paid plan out of the downloaded file with no word
  // said about it. `plan-modules.test.ts` pins the two lists.
  it('offers ru to the Action Plan but defaults it to the report language', () => {
    const picker = readFileSync(resolve(process.cwd(), 'src/target-languages.ts'), 'utf8');
    expect(/export const LANGUAGE_CODES = \[[^\]]*'ru',/s.test(picker)).toBe(true);
    const plan = readFileSync(resolve(process.cwd(), 'src/ActionPlan.tsx'), 'utf8');
    expect(plan).toContain('useState<string>(reportLanguage(props.language))');
    expect(plan).not.toContain('useState<string>(props.language)');
  });

  // And where the reader does pick Russian, the report screen says what the
  // PDF beside it will contain, rather than letting the plan vanish from it.
  // Two things it can say: the file carries the Ukrainian plan, or it carries
  // no plan at all — the API embeds the document-language plan and never falls
  // back (apps/api/src/export/pdf/plan-section.ts), so the first sentence is
  // only true once a Ukrainian plan has actually been written.
  it('says beside the PDF button what the file carries, in both cases', () => {
    expect(actionPlanCopy.ru.pdfPlanLanguage).toBe('В PDF входит план на украинском.');
    expect(actionPlanCopy.ru.pdfPlanMissing).toBe(
      'В PDF нет плана: сначала составьте его на украинском.',
    );
    const report = readFileSync(resolve(process.cwd(), 'src/Report.tsx'), 'utf8');
    expect(report).toContain('actionPlanCopy[props.language].pdfPlanLanguage');
    expect(report).toContain('actionPlanCopy[props.language].pdfPlanMissing');
    expect(report).toContain('planLanguage !== reportLanguage(props.language)');
    // The choice between them is made on the languages a plan exists in, which
    // the plan block reports up; a hint that read off the picker alone promised
    // a chapter the file would not contain.
    expect(report).toContain('writtenPlanLanguages.includes(reportLanguage(props.language))');
    expect(report).toContain('onPlanLanguagesChange={setWrittenPlanLanguages}');
  });

  // The hint is about the picker disagreeing with the document, not about
  // Russian, and the condition used to name one language instead of comparing
  // two. So both readers: a Russian one whose document is Ukrainian, and an
  // English one who switches the picker off `en` and used to be told nothing
  // while the PDF quietly carried a different chapter. Rendered rather than
  // grepped, because the condition is what was wrong.
  it('shows the hint only while the picker disagrees with the document', async () => {
    for (const language of ['ru', 'en'] as const) {
      const documentLanguage = reportLanguage(language);
      const otherLanguage = documentLanguage === 'uk' ? 'ru' : 'uk';
      const t = actionPlanCopy[language];
      stubApi((path) =>
        path.endsWith('/dashboard')
          ? envelope({
              scan: PAID_SCAN,
              overall: { verdict: 'normal', score: 74, weightedCoverage: 0.9, moduleWeights: [] },
              modules: [],
            })
          : path.endsWith('/issues/summary')
            ? envelope(OPEN_SUMMARY)
            : path.endsWith('/action-plan')
              ? envelope(IDLE_PLAN)
              : envelope(null),
      );

      render(
        <ResultsScreen
          scan={PAID_SCAN}
          language={language}
          onScan={() => {}}
          onIssues={() => {}}
          onReports={() => {}}
          onError={() => {}}
        />,
      );

      // The picker opens on the document's language, which is the plan the PDF
      // carries, so there is nothing to say about it.
      const picker = await screen.findByLabelText(t.languageLabel);
      expect(picker, language).toHaveValue(documentLanguage);
      expect(screen.queryByText(t.pdfPlanLanguage), language).not.toBeInTheDocument();
      expect(screen.queryByText(t.pdfPlanMissing), language).not.toBeInTheDocument();

      // Moved off it, and no plan is written in the document's language: the
      // file beside the button has no plan chapter at all.
      fireEvent.change(picker, { target: { value: otherLanguage } });
      expect(await screen.findByText(t.pdfPlanMissing), language).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('no interface language can reach a report enum', () => {
  // A regression guard for the shape of the mistake rather than one instance
  // of it: a call site that interpolates the interface language straight into
  // one of the three report-language requests.
  const REPORT_REQUESTS: readonly { readonly file: string; readonly pattern: RegExp }[] = [
    { file: 'src/Report.tsx', pattern: /report\.pdf\?language=\$\{(?!reportLanguage)/ },
    { file: 'src/PrintReport.tsx', pattern: /report\.pdf\?language=\$\{(?!reportLanguage)/ },
    // A request body that passes the interface language on by shorthand. The
    // field it fills is an `en | uk` enum, so the shorthand is the bug.
    { file: 'src/SupportWidget.tsx', pattern: /JSON\.stringify\(\{[^}]*\blanguage,/s },
  ];

  it.each(REPORT_REQUESTS)('$file interpolates no raw interface language', ({ file, pattern }) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(pattern.test(source)).toBe(false);
  });

  // Not that `LANGUAGES` equals its own literal, which proves nothing: that
  // the switcher offers exactly those three, and that each value it offers
  // survives the round trip through an address — a language in the list that
  // `readLanguageParam` refuses would be an option a reader cannot keep.
  it('offers every interface language in a form an address can carry', () => {
    expect(languageOptions.map((option) => option.value)).toEqual([...LANGUAGES]);
    for (const option of languageOptions) {
      expect(readLanguageParam(`?lang=${option.value}`)).toBe(option.value);
    }
    expect(readLanguageParam('?lang=be')).toBeNull();
  });
});
