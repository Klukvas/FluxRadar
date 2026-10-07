import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';

import { EMAIL_COLOR, EMAIL_MONO_FONT_STACK, EMAIL_UI_FONT_STACK } from './email-brand.ts';
import { renderPasswordResetEmail } from './password-reset-email.ts';

const LINK = 'http://localhost:5174/?reset_token=xyz789';

describe('renderPasswordResetEmail', () => {
  it('keeps the existing subject and plain-text link format', () => {
    const message = renderPasswordResetEmail(LINK);
    expect(message.subject).toBe('Reset your FluxRadar password');
    expect(message.text).toBe(
      `Reset your FluxRadar password: ${LINK}\nThe link expires in one hour.`,
    );
  });

  it('renders the link as both the CTA href and the visible fallback URL', () => {
    const { html } = renderPasswordResetEmail(LINK);
    expect(html).toContain(`href="${LINK}"`);
    expect(html.match(new RegExp(LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(
      2,
    );
  });

  it('states the 1-hour expiry and that an unrequested reset is a no-op', () => {
    const { html } = renderPasswordResetEmail(LINK);
    expect(html).toContain('one hour');
    expect(html).toContain("your password won't change");
  });

  it('escapes HTML-significant characters in the link', () => {
    const { html } = renderPasswordResetEmail('http://localhost:5174/?reset_token=a"b<c>d&e\'f');
    expect(html).not.toContain('"b<c>d&e\'f');
    expect(html).toContain('&quot;b&lt;c&gt;d&amp;e&#39;f');
  });

  it('gives the CTA link a parsed style with the full font stack, white text, and no underline', () => {
    const { html } = renderPasswordResetEmail(LINK);
    const cta = parse(html).querySelector('a');
    const style = cta?.getAttribute('style') ?? '';
    expect(style).toContain(`font-family:${EMAIL_UI_FONT_STACK};`);
    expect(style).toContain('color:#ffffff;');
    expect(style).toContain('text-decoration:none;');
  });

  it('gives the header wordmark a parsed style with the mono font and terminal-green color', () => {
    const { html } = renderPasswordResetEmail(LINK);
    const wordmark = parse(html)
      .querySelectorAll('td')
      .find((td) => td.text.trim() === 'FluxRadar');
    const style = wordmark?.getAttribute('style') ?? '';
    expect(style).toContain(`font-family:${EMAIL_MONO_FONT_STACK};`);
    expect(style).toContain(`color:${EMAIL_COLOR.terminalGreen};`);
  });

  it('shows why counting quotes misses a paired-quote font-family corruption', () => {
    // A font-family value quoted with " instead of ' still leaves the whole
    // document with an even count of " characters when the broken name is
    // itself wrapped in a matching pair (e.g. "Segoe UI") — a quote-parity
    // check would pass this. Parsing the markup shows the real damage: the
    // style="" attribute is truncated at the first embedded ", dropping
    // color and text-decoration from the CTA.
    const malformedCta =
      '<a href="https://example.com" style="font-family:-apple-system, "Segoe UI", Arial, sans-serif;color:#ffffff;text-decoration:none;">Verify email</a>';
    expect((malformedCta.match(/"/g) ?? []).length % 2).toBe(0);

    const style = parse(malformedCta).querySelector('a')?.getAttribute('style') ?? '';
    expect(style).not.toContain('color:#ffffff');
    expect(style).not.toContain('text-decoration:none');
  });

  it('is a single self-contained document with no external resources or scripts', () => {
    const { html } = renderPasswordResetEmail(LINK);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toMatch(/url\(https?:/);
  });
});
