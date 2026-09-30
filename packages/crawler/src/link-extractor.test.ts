import { describe, expect, it } from 'vitest';

import { extractLinks, isCloudflareEmailObfuscationUrl } from './link-extractor.js';

const ORIGIN = 'https://fixture.test';
const CF_EMAIL_PATH = '/cdn-cgi/l/email-protection';
/** What Cloudflare writes: a key byte plus the address, two hex chars per byte. */
const CF_EMAIL_FRAGMENT = '6a03040c056a1e030f';

describe('extractLinks: Cloudflare email obfuscation', () => {
  it('does not queue the email-protection endpoint, and keeps the page links around it', () => {
    const links = extractLinks(
      `<a href="${CF_EMAIL_PATH}#${CF_EMAIL_FRAGMENT}">email</a><a href="/missing">missing</a>`,
      ORIGIN,
    );

    expect(links).toEqual([`${ORIGIN}/missing`]);
  });

  it('keeps an href that only looks like it: no fragment, non-hex, other path', () => {
    // Suppressing these would hide a real broken link under a Cloudflare-shaped
    // name — the endpoint is recognized by its exact shape, not by its prefix.
    const links = extractLinks(
      `<a href="${CF_EMAIL_PATH}">bare</a>` +
        `<a href="${CF_EMAIL_PATH}#not-hex">invalid</a>` +
        '<a href="/cdn-cgi/other#6a03040c">other</a>',
      ORIGIN,
    );

    expect(links).toEqual([
      `${ORIGIN}${CF_EMAIL_PATH}`,
      `${ORIGIN}${CF_EMAIL_PATH}#not-hex`,
      `${ORIGIN}/cdn-cgi/other#6a03040c`,
    ]);
  });
});

describe('isCloudflareEmailObfuscationUrl', () => {
  it('accepts the exact endpoint with a nonempty even-length hexadecimal fragment', () => {
    expect(
      isCloudflareEmailObfuscationUrl(new URL(`${CF_EMAIL_PATH}#${CF_EMAIL_FRAGMENT}`, ORIGIN)),
    ).toBe(true);
    // Cloudflare writes lowercase, but a hand-edited template may not.
    expect(
      isCloudflareEmailObfuscationUrl(
        new URL(`${CF_EMAIL_PATH}#${CF_EMAIL_FRAGMENT.toUpperCase()}`, ORIGIN),
      ),
    ).toBe(true);
  });

  it('rejects anything that is not that shape', () => {
    const rejected = [
      CF_EMAIL_PATH,
      `${CF_EMAIL_PATH}#`,
      `${CF_EMAIL_PATH}#not-hex`,
      // Odd length: no whole byte count, so it is not an encoded address.
      `${CF_EMAIL_PATH}#6a03040c0`,
      `/cdn-cgi/other#${CF_EMAIL_FRAGMENT}`,
      `/cdn-cgi/l/email-protection/extra#${CF_EMAIL_FRAGMENT}`,
      `/#${CF_EMAIL_FRAGMENT}`,
    ];
    for (const href of rejected) {
      expect(isCloudflareEmailObfuscationUrl(new URL(href, ORIGIN)), href).toBe(false);
    }
  });
});
