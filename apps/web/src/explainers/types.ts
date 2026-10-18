// The shape every plain-language explanation shares, and the sentences several
// rules reuse. The header of `../finding-explainers.ts` says what they are for.

export interface FindingExplainer {
  /** The problem's name in the owner's words — no header, attribute or acronym. */
  readonly title: string;
  /** What the check found, without naming a header or an attribute. */
  readonly what: string;
  /** Why it is worth a developer's time — no attack claims, no promises. */
  readonly why: string;
  /** The one thing the owner can do about it. */
  readonly fix: string;
  /** What one finding of this rule is, so the count can be read correctly. */
  readonly count: string;
  /**
   * Where the finding's data came from, for a rule that does not read the
   * crawled pages' public responses — the Google data the owner connected, or
   * the address checks the owner listed. Absent, the report's general sentence
   * about public responses applies.
   */
  readonly scope?: string;
}

export interface ExplainedRule {
  /**
   * Whether a finding of this rule is one page — at most one finding per page —
   * so a count of findings can be said as a count of pages. False for a rule
   * that reports per cookie, per link, per address group or per AI remark.
   */
  readonly countsPages: boolean;
  /**
   * Whether a finding is an AI review's remark rather than a deterministic
   * check. Its `what` is the only sentence saying so — and that it read the
   * page text only — so a list that folds `what` away must still show it.
   */
  readonly isAiReview?: boolean;
  readonly en: FindingExplainer;
  readonly uk: FindingExplainer;
}

export const ASK_DEVELOPER_SERVER_EN =
  'Ask your website developer to set this protection up on the server and to check that the site still works as before. The specifics are in the technical details.';

export const ASK_DEVELOPER_SERVER_UK =
  'Попросіть розробника налаштувати цей захист на сервері та перевірити, що сайт працює як раніше. Точний перелік є в технічних деталях.';

export const AI_REVIEW_COUNT_EN =
  'One finding for each point the review raised, so one page can appear more than once.';
export const AI_REVIEW_COUNT_UK =
  'Одна знахідка на кожне зауваження перевірки, тож одна сторінка може зʼявитися кілька разів.';
