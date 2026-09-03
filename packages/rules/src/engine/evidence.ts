// Обрезка evidence_excerpt по §16: лимит считается в Unicode code points,
// не в байтах и не в UTF-16 code units (EVIDENCE_EXCERPT_MAX_CHARS).

import { EVIDENCE_EXCERPT_MAX_CHARS } from '@fluxradar/contracts';

export function truncateExcerpt(text: string): string {
  const codePoints = [...text];
  if (codePoints.length <= EVIDENCE_EXCERPT_MAX_CHARS) {
    return text;
  }
  return codePoints.slice(0, EVIDENCE_EXCERPT_MAX_CHARS).join('');
}
