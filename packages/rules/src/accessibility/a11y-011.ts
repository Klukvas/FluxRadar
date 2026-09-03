// A11Y-011 — прозрачность отчёта (report contract, не page finding).
// Реальный результат «manual review required» формируется интерфейсом и
// документацией модуля; правило резервирует стабильный inventory ID и
// учитывает site-level audit contract без искусственного issue/penalty.

import { requireDescriptor } from '../engine/descriptor.js';
import type { SiteRule } from '../engine/types.js';

const descriptor = requireDescriptor('A11Y-011');

export const a11y011ReportTransparency: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite: () => ({ findings: [], applicableTargets: 1, affectedTargets: 0 }),
};
