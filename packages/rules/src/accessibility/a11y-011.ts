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
  // checkedTargets пуст сознательно: правило ничего не читает и находок не
  // создаёт, поэтому доказывать повторную проверку ему нечем и не за что.
  evaluateSite: () => ({
    findings: [],
    applicableTargets: 1,
    affectedTargets: 0,
    checkedTargets: [],
  }),
};
