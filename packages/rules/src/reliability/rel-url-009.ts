// REL-URL-009 — время ответа (page-level; severity из реестра).
//
// Оракул: timingMs финального ответа строго больше порога 1800 ms (§9:
// «времени ответа выше 1.8 секунды») → finding; ровно 1800 ms — норма
// (boundary-фикстура 1800/1801). §9 относит превышение к warning-verdict,
// но собственного «warning-пути» без findings у времени ответа нет — это
// единственный сигнал правила, поэтому он scored (Medium из реестра).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';

const descriptor = requireDescriptor('REL-URL-009');

/** Порог §9: 1.8 s; значение ровно на пороге — ещё не finding. */
export const RESPONSE_TIME_THRESHOLD_MS = 1800;

export const relUrl009ResponseTime: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: hasHttpResponse,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    if (page.timingMs <= RESPONSE_TIME_THRESHOLD_MS) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: findingMessage('rel-url-009.evidence', {
          responseMs: page.timingMs,
          thresholdMs: RESPONSE_TIME_THRESHOLD_MS,
          status: page.status,
          url: page.finalUrl,
        }),
        recommendation: findingMessage('rel-url-009.recommendation', {
          thresholdMs: RESPONSE_TIME_THRESHOLD_MS,
        }),
      }),
    ];
  },
};
