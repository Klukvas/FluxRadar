// Security-модуль rules-mvp-0.1 (T-09): passive-проверки поверх снимков
// обхода. Порядок — по ruleId реестра.

import type { Rule } from '../engine/types.js';
import { secPassive002SecurityHeaders } from './sec-passive-002.js';
import { secPassive003Hsts } from './sec-passive-003.js';
import { secPassive005CookieAttributes } from './sec-passive-005.js';

export const SECURITY_RULES: readonly Rule[] = [
  secPassive002SecurityHeaders,
  secPassive003Hsts,
  secPassive005CookieAttributes,
];
