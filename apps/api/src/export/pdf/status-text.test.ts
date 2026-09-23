// The document's own words for a scan's status and its machine `status_reason`.
//
// The defect this suite exists for: the Sections table of a Ukrainian report
// read "Partial · PerformanceSamplesIncomplete", a machine token the reader
// cannot act on and cannot even read. The last test is the guard that keeps it
// from coming back — it takes the producers' own constants and requires a clause
// for every token they can write, so a new reason fails here rather than
// appearing untranslated in a customer's file.

import { AI_UNAVAILABLE_REASONS } from '@fluxradar/ai';
import {
  ISSUE_STATUSES,
  MODULE_RUNTIME_STATUSES,
  SCAN_RUNTIME_STATUSES,
} from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { STATUS_REASONS as BILLING_STATUS_REASONS } from '../../billing/constants.ts';
import { statusReasonFor } from '../../orchestrator/analytics/module-row.ts';
import { MODULE_STATUS_REASONS } from '../../orchestrator/module-result.ts';
import { PERFORMANCE_STATUS_REASONS } from '../../orchestrator/performance-module.ts';
import {
  issueStatusText,
  moduleResultText,
  scanStatusText,
  statusReasonText,
} from './status-text.ts';

describe('moduleResultText', () => {
  it('states a section that simply completed without inventing a reason for it', () => {
    const module = { runtimeStatus: 'Completed', statusReason: null };
    expect(moduleResultText(module, 'en')).toBe('Completed');
    expect(moduleResultText(module, 'uk')).toBe('Завершено');
  });

  it('speaks the performance reason instead of printing its token', () => {
    const module = {
      runtimeStatus: 'Partial',
      statusReason: PERFORMANCE_STATUS_REASONS.partialCoverage,
    };
    const uk = moduleResultText(module, 'uk');
    expect(uk).toContain('Перевірено з обмеженнями');
    expect(uk).toContain('вимірювальних запусків не завершилася');
    expect(uk).not.toContain('PerformanceSamplesIncomplete');
    expect(uk).not.toContain('Partial');

    const en = moduleResultText(module, 'en');
    expect(en).toContain('Checked with limits');
    expect(en).toContain('some measurement runs did not finish');
    expect(en).not.toContain('PerformanceSamplesIncomplete');
  });

  it('keeps a status this build does not know as itself rather than guessing', () => {
    expect(moduleResultText({ runtimeStatus: 'Rehearsing', statusReason: null }, 'uk')).toBe(
      'Rehearsing',
    );
  });

  it.each(MODULE_RUNTIME_STATUSES)('says a %s section in Ukrainian', (runtimeStatus) => {
    expect(moduleResultText({ runtimeStatus, statusReason: null }, 'uk')).not.toBe(runtimeStatus);
  });
});

describe('scanStatusText', () => {
  it.each(SCAN_RUNTIME_STATUSES)('says a %s scan in Ukrainian', (status) => {
    expect(scanStatusText({ status, statusReason: null }, 'uk')).not.toBe(status);
  });

  it('states the scan outcome and the billing reason in the reader’s language', () => {
    const scan = { status: 'Partial', statusReason: BILLING_STATUS_REASONS.externalModuleFailure };
    expect(scanStatusText(scan, 'en')).toBe(
      'Partly complete · an external service cost this scan at least one section',
    );
    expect(scanStatusText(scan, 'uk')).toBe(
      'Завершено частково · через зовнішній сервіс ця перевірка втратила щонайменше один розділ',
    );
  });
});

describe('issueStatusText', () => {
  it.each(ISSUE_STATUSES)('says where a %s finding stands in both languages', (status) => {
    expect(issueStatusText(status, 'en')).not.toBe('');
    const uk = issueStatusText(status, 'uk');
    expect(uk).not.toBe('');
    expect(uk).not.toBe(status);
  });

  it('keeps a status this build does not know as itself', () => {
    expect(issueStatusText('Escalated', 'uk')).toBe('Escalated');
  });
});

describe('statusReasonText', () => {
  it('has nothing to say when the row carries no reason', () => {
    expect(statusReasonText(null, 'en')).toBeNull();
    expect(statusReasonText('   ', 'uk')).toBeNull();
  });

  it('quotes a reason this build has no clause for instead of paraphrasing it', () => {
    const stated = statusReasonText('PerformanceRunnerUnavailable', 'uk');
    expect(stated).toBe('причина, записана аудитом: PerformanceRunnerUnavailable');
    expect(statusReasonText('PerformanceRunnerUnavailable', 'en')).toBe(
      'reason recorded by the audit: PerformanceRunnerUnavailable',
    );
  });

  it('says which review an AI refusal stopped when the UX module reports it', () => {
    expect(statusReasonText('UxAiQuotaExceeded', 'en')).toBe(
      'the AI-assisted UX review did not run — this plan’s allowance of AI questions was already used',
    );
    expect(statusReasonText('UxAiQuotaExceeded', 'uk')).toBe(
      'AI-огляд UX не виконано — ліміт AI-запитів цього тарифу вже вичерпано',
    );
  });

  it('counts a partly answered GEO run and names each distinct cause once', () => {
    const stated = statusReasonText(
      '3 of 12 AI requests unavailable (QuotaExceeded, ProviderUnavailable, QuotaExceeded)',
      'uk',
    );
    expect(stated).toBe(
      '3 з 12 AI-запитів не вдалося виконати; ліміт AI-запитів цього тарифу вже вичерпано; ' +
        'постачальника AI не налаштовано тут або він не відповів',
    );
    expect(stated).not.toContain('QuotaExceeded');
  });

  it('quotes a composed GEO reason whose wording no longer matches, rather than mistranslating it', () => {
    const changed = '3 of 12 AI calls skipped [QuotaExceeded]';
    expect(statusReasonText(changed, 'en')).toBe(`reason recorded by the audit: ${changed}`);
  });
});

/**
 * Every reason token the API can write, read from the producers themselves.
 *
 * `ProfileContextMissing` (orchestrator/geo.ts), `EmptyQuestionLibrary`
 * (packages/ai/src/geo-module.ts), the two platform failures (worker.ts) and
 * `NoDeterministicOracle` (a stub row stored by earlier releases, which this
 * document still renders) are literals at their producer, so they are named
 * here as literals too.
 */
function producedReasons(): readonly string[] {
  const analyticsStates = [
    'not_connected',
    'no_property_selected',
    'needs_reconnect',
    'no_access',
    'no_data',
    'request_failed',
  ] as const;
  return [
    ...Object.values(MODULE_STATUS_REASONS),
    ...Object.values(PERFORMANCE_STATUS_REASONS),
    ...Object.values(BILLING_STATUS_REASONS),
    ...analyticsStates.map((state) => statusReasonFor(state)),
    ...AI_UNAVAILABLE_REASONS,
    ...AI_UNAVAILABLE_REASONS.map((reason) => `UxAi${reason}`),
    'EmptyQuestionLibrary',
    // The GEO run's own reasons, plain and counted. The counted one is the
    // shape `geo-module-row.ts` writes when the owner stopped a run that had
    // already paid for some of its answers.
    'ScanCancelled',
    'ScanCancelled: 2 of 5 questions answered',
    'ProfileContextMissing',
    'PlatformFailure',
    'PlatformFailureBeforeCompletion',
    'NoDeterministicOracle',
  ];
}

describe('the producers’ vocabulary', () => {
  it.each(producedReasons())('explains %s in both languages', (reason) => {
    for (const language of ['en', 'uk'] as const) {
      const stated = statusReasonText(reason, language);
      expect(stated).not.toBeNull();
      expect(stated).not.toContain(reason);
    }
  });
});
