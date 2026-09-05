import { randomUUID } from 'node:crypto';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export type EmailDeliveryStatus = 'sent' | 'not-configured' | 'provider-error';
export const RESEND_TIMEOUT_MS = 10_000;

export interface Mailer {
  readonly configured: boolean;
  send(
    message: EmailMessage,
  ): Promise<{ readonly status: EmailDeliveryStatus; readonly id?: string }>;
}

export class MockMailer implements Mailer {
  readonly configured = true;
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ readonly status: 'sent'; readonly id: string }> {
    this.messages.push(message);
    return { status: 'sent', id: `mock-${randomUUID()}` };
  }
}

export class NotConfiguredMailer implements Mailer {
  readonly configured = false;

  async send(): Promise<{ readonly status: 'not-configured' }> {
    return { status: 'not-configured' };
  }
}

export class ResendMailer implements Mailer {
  readonly configured = true;
  private readonly apiKey: string;
  private readonly from: string;
  private readonly replyTo: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: {
    readonly apiKey: string;
    readonly from: string;
    readonly replyTo?: string;
    readonly fetcher?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.replyTo = options.replyTo;
    this.fetcher = options.fetcher ?? fetch;
  }

  async send(message: EmailMessage): Promise<{ readonly status: 'sent'; readonly id: string }> {
    const response = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(this.replyTo === undefined ? {} : { reply_to: this.replyTo }),
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend request failed with HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    const id =
      typeof payload === 'object' &&
      payload !== null &&
      'id' in payload &&
      typeof payload.id === 'string'
        ? payload.id
        : 'resend-accepted';
    return { status: 'sent', id };
  }
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Production uses Resend when connected; development and tests are deterministic
 * and offline. Resend is optional until its keys are configured: with the API
 * key or sender absent in production this returns a `NotConfiguredMailer`, so
 * email-dependent flows stay safely disabled and surface `not-configured`
 * instead of silently claiming a message was sent.
 */
export function createMailer(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Mailer {
  const apiKey = optional(env.RESEND_API_KEY);
  const from = optional(env.RESEND_FROM_EMAIL);
  if (env.NODE_ENV !== 'production') return new MockMailer();
  if (apiKey === null || from === null) return new NotConfiguredMailer();
  const replyTo = optional(env.RESEND_REPLY_TO);
  return new ResendMailer({ apiKey, from, ...(replyTo === null ? {} : { replyTo }), fetcher });
}

export function emailText(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });
}
