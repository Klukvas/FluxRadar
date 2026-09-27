// The shape of the public coverage page (/checks): its sections, their reading
// order and the types every locale fills in. The two locale bodies live beside
// it (`checks-copy.en.ts`, `checks-copy.uk.ts`) and `checks-copy.ts` is what the
// app imports — the prose of one language alone runs to several hundred lines,
// and a single file holding both stopped being editable.
//
// Every locale builds its sections through `checksSections`, so a section that
// exists in one language and not the other is a type error rather than a page
// that quietly loses an anchor when the reader switches language.
//
// Two inline markers are allowed inside a paragraph or a bullet body:
// `code` renders as <code> and **strong** as <strong>. Anything else is text.

export type ChecksSectionId =
  | 'how'
  | 'seo'
  | 'ai-seo'
  | 'security'
  | 'accessibility'
  | 'reliability'
  | 'content'
  | 'privacy'
  | 'evidence'
  | 'limits';

/** Anchor and reading order, shared by every locale. */
const SECTION_ORDER: readonly ChecksSectionId[] = [
  'how',
  'seo',
  'ai-seo',
  'security',
  'accessibility',
  'reliability',
  'content',
  'privacy',
  'evidence',
  'limits',
];

/** The index rule separates the modules from the two closing sections. */
export const CHECKS_INDEX_RULE_BEFORE: ChecksSectionId = 'evidence';

export interface ChecksBullet {
  /** The lead term, rendered in bold before the em dash. */
  readonly term: string;
  readonly body: string;
}

export interface ChecksSectionText {
  /** Short label used in the sidebar index. */
  readonly nav: string;
  /** Numbered kicker rendered above the section heading. */
  readonly label: string;
  readonly title: string;
  /** Paragraphs before the list. */
  readonly intro: readonly string[];
  readonly bullets: readonly ChecksBullet[];
  /** Paragraphs after the list. */
  readonly outro: readonly string[];
}

export interface ChecksSection extends ChecksSectionText {
  readonly id: ChecksSectionId;
}

export interface ChecksCopy {
  readonly kicker: string;
  readonly meta: readonly string[];
  readonly title: string;
  readonly lede: string;
  readonly back: string;
  readonly contents: string;
  readonly documentLabel: string;
  readonly noticeLabel: string;
  readonly notice: string;
  readonly noticeTag: string;
  readonly contact: string;
  readonly contactEmail: string;
  readonly footerBrand: string;
  readonly footerHome: string;
  readonly footerPrivacy: string;
  readonly footerTerms: string;
  readonly sections: readonly ChecksSection[];
}

/** Section bodies in reading order, each stamped with its anchor id. */
export function checksSections(
  sections: Record<ChecksSectionId, ChecksSectionText>,
): readonly ChecksSection[] {
  return SECTION_ORDER.map((id) => ({ id, ...sections[id] }));
}
