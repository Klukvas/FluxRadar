// The "cancel this scan?" dialog on the progress screen.
//
// It was six `language === 'uk' ? … : …` ternaries nested inside a conditional
// on the refund category, which `copy-parity.test.ts` could not read and a
// third language made unreadable. The refund wording is the part that matters:
// each branch says what cancelling does to the money, and the three branches
// must not drift apart between languages.

import type { Language } from './i18n';

export type ScanCancelCopy = {
  readonly moreActions: string;
  readonly title: string;
  /** An unpaid check: nothing was charged. */
  readonly unpaid: string;
  /** Paid, not yet queued: a full refund. */
  readonly beforeQueue: string;
  /** Paid and already queued or running: no automatic refund. */
  readonly afterQueue: string;
  readonly keep: string;
};

export const scanCancelCopy: Readonly<Record<Language, ScanCancelCopy>> = {
  en: {
    moreActions: 'More actions',
    title: 'Cancel this scan?',
    unpaid:
      'This is an unpaid check, so nothing was charged. We will check its state again before cancelling.',
    beforeQueue:
      'This scan has not entered the queue. If it was paid for, cancelling before it starts receives a full refund. We will check its state again before acting.',
    afterQueue:
      'This scan has entered the queue or started: no automatic refund is available. We will check its state again before acting.',
    keep: 'Keep scan',
  },
  uk: {
    moreActions: 'Інші дії',
    title: 'Скасувати перевірку?',
    unpaid:
      'Це неоплачена перевірка: списання не було. Перед скасуванням ми ще раз перевіримо її стан.',
    beforeQueue:
      'Цю перевірку ще не поставлено в чергу. Якщо її оплачено, скасування до старту має повне повернення. Перед дією ми ще раз перевіримо стан.',
    afterQueue:
      'Цю перевірку вже поставлено в чергу або запущено: автоматичне повернення не передбачене. Перед дією ми ще раз перевіримо її стан.',
    keep: 'Продовжити перевірку',
  },
  ru: {
    moreActions: 'Другие действия',
    title: 'Отменить проверку?',
    unpaid:
      'Это неоплаченная проверка: списания не было. Перед отменой мы ещё раз проверим её состояние.',
    beforeQueue:
      'Эта проверка ещё не поставлена в очередь. Если она оплачена, отмена до старта даёт полный возврат. Перед действием мы ещё раз проверим состояние.',
    afterQueue:
      'Эта проверка уже поставлена в очередь или запущена: автоматический возврат не предусмотрен. Перед действием мы ещё раз проверим её состояние.',
    keep: 'Продолжить проверку',
  },
};
