// evidence_group_id (§14 cross-module policy): одинаковое evidence в разных
// модулях (например, img без alt — SEO-ONPAGE-005 и A11Y-002) намеренно даёт
// два findings; их связывает non-scoring идентификатор, который не входит в
// fingerprint и не влияет на score. Детерминизм: sha256 от категории evidence
// и normalizedUrl цели, разделённых NUL (категории и URL NUL не содержат).

import { createHash } from 'node:crypto';

const EVIDENCE_GROUP_PREFIX = 'evg-v1';

/** Категория «img без alt» — общая для SEO-ONPAGE-005 и A11Y-002 (§14). */
export const IMG_ALT_EVIDENCE_CATEGORY = 'img-alt';
const SEPARATOR = '\u0000';

/** Детерминированный id группы: одинаков у всех правил той же категории/цели. */
export function evidenceGroupId(category: string, normalizedUrl: string): string {
  const digest = createHash('sha256')
    .update([EVIDENCE_GROUP_PREFIX, category, normalizedUrl].join(SEPARATOR))
    .digest('hex');
  return `${EVIDENCE_GROUP_PREFIX}:${digest}`;
}
