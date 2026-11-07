// Whether a quote a model handed back really occurs in the text it claims to
// quote.
//
// Shared by the claim checks and the tone check of the GEO evaluator: both rest
// on the same rule — a model's quote is accepted only when a reader could find
// it in the answer (or the evidence) they are shown, whatever punctuation style
// the model chose.
//
// Ukrainian text (W1) writes its apostrophe as ʼ (U+02BC), and a model quoting
// it routinely re-types it as ' or ’ — so every apostrophe look-alike folds to
// one, and the guillemets «» fold to a straight double quote. Only punctuation
// folds: a quote whose words are not in the text is still rejected.

const APOSTROPHE_LIKE = /[‘’‛′ʼʹ`´']/g;
const DOUBLE_QUOTE_LIKE = /[“”‟″«»]/g;

function foldPunctuation(text: string): string {
  return text.replace(APOSTROPHE_LIKE, "'").replace(DOUBLE_QUOTE_LIKE, '"');
}

function normalizeForQuoteMatch(text: string): string {
  // Folded before NFKC as well as after: NFKC decomposes ´ into a space plus a
  // combining accent, and turns full-width look-alikes into ASCII ones.
  return foldPunctuation(foldPunctuation(text).normalize('NFKC'))
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
