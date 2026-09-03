// Accessibility-модуль rules-mvp-0.1 (T-09). Порядок — по ruleId реестра.

import type { Rule } from '../engine/types.js';
import { a11y001Contrast } from './a11y-001.js';
import { a11y002ImageAlt } from './a11y-002.js';
import { a11y003DocumentStructure } from './a11y-003.js';
import { a11y004FormLabels } from './a11y-004.js';
import { a11y005KeyboardNavigation } from './a11y-005.js';
import { a11y006FocusVisible } from './a11y-006.js';
import { a11y007Aria } from './a11y-007.js';
import { a11y008InteractiveNames } from './a11y-008.js';
import { a11y009FormErrors } from './a11y-009.js';
import { a11y010ScreenReaderEvidence } from './a11y-010.js';
import { a11y011ReportTransparency } from './a11y-011.js';

export const ACCESSIBILITY_RULES: readonly Rule[] = [
  a11y001Contrast,
  a11y002ImageAlt,
  a11y003DocumentStructure,
  a11y004FormLabels,
  a11y005KeyboardNavigation,
  a11y006FocusVisible,
  a11y007Aria,
  a11y008InteractiveNames,
  a11y009FormErrors,
  a11y010ScreenReaderEvidence,
  a11y011ReportTransparency,
];
