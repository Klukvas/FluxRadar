// Reliability-модуль rules-mvp-0.1 (T-09): url-проверки поверх снимков
// обхода + api-проверки поверх ctx.apiChecks (§9 contract v1).
// Порядок — по ruleId реестра.

import type { Rule } from '../engine/types.js';
import { relApi003ExpectedStatus } from './rel-api-003.js';
import { relApi005NoCredentials } from './rel-api-005.js';
import { relUrl001Availability } from './rel-url-001.js';
import { relUrl003ServerErrors } from './rel-url-003.js';
import { relUrl009ResponseTime } from './rel-url-009.js';

export const RELIABILITY_RULES: readonly Rule[] = [
  relApi003ExpectedStatus,
  relApi005NoCredentials,
  relUrl001Availability,
  relUrl003ServerErrors,
  relUrl009ResponseTime,
];
