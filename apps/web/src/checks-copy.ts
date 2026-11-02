// Public audit-coverage content (/checks), kept out of `i18n.ts` for the same
// reason the FAQ is: it is a long technical document, and a wall of prose inside
// the shared translation file makes both harder to edit.
//
// This module is the page's whole public surface; the document itself is split
// by the only seam it has — shape versus prose — because one file holding the
// shape and both languages crossed the length at which it can still be read:
// `checks-copy-sections.ts` for the sections and their types, and
// `checks-copy.en.ts`, `checks-copy.uk.ts`, `checks-copy.ru.ts` for the bodies.

export {
  CHECKS_INDEX_RULE_BEFORE,
  type ChecksBullet,
  type ChecksCopy,
  type ChecksSection,
  type ChecksSectionId,
  type ChecksSectionText,
} from './checks-copy-sections';
export { checksCopyEn } from './checks-copy.en';
export { checksCopyRu } from './checks-copy.ru';
export { checksCopyUk } from './checks-copy.uk';
