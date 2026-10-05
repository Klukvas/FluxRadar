import type { Language } from './i18n';

/**
 * The folded line the ownership panel starts as. DNS records, files and meta
 * tags read as a demand to a non-technical owner, so the panel opens with what
 * it is and why it is safe to ignore; the technical copy in i18n.ts is shown
 * only once they unfold it.
 */
type DomainOwnershipCopy = {
  readonly summary: string;
  readonly why: string;
};

export const domainOwnershipCopy: Readonly<Record<Language, DomainOwnershipCopy>> = {
  en: {
    summary: 'Confirm this is your site (optional)',
    why: 'It only records that this account controls the site; scans, plans and prices work the same without it.',
  },
  uk: {
    summary: 'Підтвердьте, що це ваш сайт (необов’язково)',
    why: 'Це лише фіксує, що цей акаунт керує сайтом; перевірки, тарифи й ціни працюють так само і без цього.',
  },
};
