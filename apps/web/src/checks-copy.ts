// Public audit-coverage content (/checks), kept out of `i18n.ts` for the same
// reason the FAQ is: it is a long technical document, and a wall of prose inside
// the shared translation file makes both harder to edit.
//
// This module is the page's whole public surface; the document itself is split
// by the only seam it has — shape versus prose — because one file holding the
// shape and both languages crossed the length at which it can still be read:
// `checks-copy-sections.ts` for the sections and their types,
// `checks-copy.en.ts` and `checks-copy.uk.ts` for the two bodies.

export {
  CHECKS_INDEX_RULE_BEFORE,
  type ChecksBullet,
  type ChecksCopy,
  type ChecksSection,
  type ChecksSectionId,
  type ChecksSectionText,
} from './checks-copy-sections';
export { checksCopyEn } from './checks-copy.en';
export { checksCopyUk } from './checks-copy.uk';
