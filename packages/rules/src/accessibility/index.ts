// Accessibility-модуль rules-mvp-0.1 (T-09). Порядок — по ruleId реестра.

import type { Rule } from '../engine/types.js';
import { a11y002ImageAlt } from './a11y-002.js';
import { a11y004FormLabels } from './a11y-004.js';

export const ACCESSIBILITY_RULES: readonly Rule[] = [a11y002ImageAlt, a11y004FormLabels];
