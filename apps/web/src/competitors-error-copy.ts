import type { CompetitorsInputError } from './competitors-input';
import { copy, fillCopy, type Language } from './i18n';

/** The competitors field's live validation message, in the reader's words (T7). */
export function competitorsErrorMessage(error: CompetitorsInputError, language: Language): string {
  const w = copy[language].workspace;
  switch (error.kind) {
    case 'too-many':
      return w.competitorsErrorTooMany;
    case 'too-short':
      return w.competitorsErrorTooShort;
    case 'too-long':
      return w.competitorsErrorTooLong;
    case 'duplicate':
      return fillCopy(w.competitorsErrorDuplicate, { name: error.name });
    case 'own-brand':
      return fillCopy(w.competitorsErrorOwnBrand, { name: error.name });
  }
}
