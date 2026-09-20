// What a support request is, and how it reads in the support channel.

/**
 * Who a reply goes to. A signed-in request carries the account's own address; a
 * guest's is whatever they typed into a public form, so the channel is told it
 * is unverified rather than shown both the same way.
 */
export type SupportSender =
  | { readonly kind: 'account'; readonly accountId: string; readonly email: string }
  | { readonly kind: 'guest'; readonly email: string };

export interface SupportRequest {
  readonly sender: SupportSender;
  readonly subject: string;
  readonly message: string;
  /** The path the form was opened on, without its query. */
  readonly page: string | null;
  readonly language: 'en' | 'uk' | null;
}

/**
 * Telegram's HTML parse mode rejects the whole message on a stray `<` or `&`, and
 * everything interpolated below was typed by a visitor.
 */
export function telegramHtml(value: string): string {
  return value.replace(/[&<>]/g, (character) =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;',
  );
}

function senderLine(sender: SupportSender): string {
  const email = telegramHtml(sender.email);
  return sender.kind === 'account'
    ? `${email} — signed in, account <code>${telegramHtml(sender.accountId)}</code>`
    : `${email} — guest, address not verified`;
}

export function formatSupportMessage(request: SupportRequest): string {
  return [
    '<b>📩 FluxRadar support request</b>',
    '',
    `<b>From:</b> ${senderLine(request.sender)}`,
    ...(request.page === null ? [] : [`<b>Page:</b> ${telegramHtml(request.page)}`]),
    ...(request.language === null ? [] : [`<b>Language:</b> ${request.language}`]),
    `<b>Subject:</b> ${telegramHtml(request.subject)}`,
    '',
    '<b>Message:</b>',
    telegramHtml(request.message),
  ].join('\n');
}
