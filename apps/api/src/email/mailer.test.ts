import { describe, expect, it, vi } from 'vitest';

import { MockMailer, ResendMailer, createMailer } from './mailer.ts';

describe('transactional email adapters', () => {
  it('uses an offline deterministic mailer outside production', async () => {
    const mailer = createMailer({ NODE_ENV: 'test', RESEND_API_KEY: 'must-not-be-used' });
    expect(mailer).toBeInstanceOf(MockMailer);
    expect(
      (await mailer.send({ to: 'test@example.com', subject: 'Test', html: '<p>x</p>', text: 'x' }))
        .status,
    ).toBe('sent');
  });

  it('does not claim production email is configured without both values', () => {
    expect(createMailer({ NODE_ENV: 'production' }).configured).toBe(false);
  });

  it('reports not-configured instead of pretending to send when Resend is absent', async () => {
    const mailer = createMailer({ NODE_ENV: 'production', RESEND_API_KEY: 'only-key' });
    expect(mailer.configured).toBe(false);
    const result = await mailer.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
    expect(result.status).toBe('not-configured');
  });

  it('sends the documented Resend request without exposing the key in the body', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    const mailer = new ResendMailer({
      apiKey: 'secret-key',
      from: 'FluxRadar <mail@example.com>',
      fetcher,
    });
    const result = await mailer.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
    expect(result).toEqual({ status: 'sent', id: 'email-1' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
      }),
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(String(init?.body)).not.toContain('secret-key');
  });
});
