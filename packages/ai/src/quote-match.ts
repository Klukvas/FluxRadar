// Whether a quote a model handed back really occurs in the text it claims to
// quote.
//
// Shared by the claim checks and the tone check of the GEO evaluator: both rest
// on the same rule — a model's quote is accepted only when a reader could find
// it in the answer (or the evidence) they are shown, whatever punctuation style
// the model chose.

function normalizeForQuoteMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** A quote counts only if the text really contains it; punctuation style may differ. */
export function quoteOccursIn(haystack: string, quote: string): boolean {
  const needle = normalizeForQuoteMatch(quote).replace(/^[.…\s]+|[.…\s]+$/g, '');
  if (needle === '') return false;
  return normalizeForQuoteMatch(haystack).includes(needle);
}
