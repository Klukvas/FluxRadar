// Security-модуль rules-mvp-0.1 (T-09): passive-проверки поверх снимков
// обхода. Порядок — по ruleId реестра.

import type { Rule } from '../engine/types.js';
import { secAsvs001Csp } from './sec-asvs-001-csp.js';
import { secAsvs002PermissionsPolicy } from './sec-asvs-002-permissions-policy.js';
import { secAsvs003Cors } from './sec-asvs-003-cors.js';
import { secPassive002SecurityHeaders } from './sec-passive-002.js';
import { secPassive003Hsts } from './sec-passive-003.js';
import { secPassive005CookieAttributes } from './sec-passive-005.js';

export const SECURITY_RULES: readonly Rule[] = [
  secPassive002SecurityHeaders,
  secPassive003Hsts,
  secPassive005CookieAttributes,
  secAsvs001Csp,
  secAsvs002PermissionsPolicy,
  secAsvs003Cors,
];
