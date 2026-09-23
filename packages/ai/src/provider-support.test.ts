// The shared adapter plumbing, tested where it is written rather than four
// times over: these are the rules that decide what a model-supplied link may do
// to a reader, and what a cancelled run costs.

import { describe, expect, it } from 'vitest';

import { AiRequestCancelledError } from './errors.js';
import { boundedCitations, isSafeCitationUrl, readJsonBody } from './provider-support.js';

const CAPS = (maxCitationUnits: number) => ({
  maxInputTokens: 8_000,
  maxOutputTokens: 2_000,
  maxReasoningUnits: 4_000,
  maxSearchUnits: 3,
  maxCitationUnits,
  maxSearchContentTokens: 4_000,
});

describe('boundedCitations', () => {
  it('keeps the first citations in order, without duplicates', () => {
    expect(
      boundedCitations(
        ['https://a.example/1', 'https://a.example/1', 'https://b.example/2'],
        CAPS(5),
      ),
    ).toEqual(['https://a.example/1', 'https://b.example/2']);
  });

  it('stops at the cap', () => {
    expect(boundedCitations(['https://a.example/1', 'https://b.example/2'], CAPS(1))).toEqual([
      'https://a.example/1',
    ]);
  });

  it('keeps none when the request allows none', () => {
    // The Action Plan runs with maxCitationUnits: 0. A cap that only applied
    // after the first citation was kept would put links in a record that says
    // it has none — and fail the §5 contract check on the way past.
    expect(boundedCitations(['https://a.example/1', 'https://b.example/2'], CAPS(0))).toEqual([]);
  });

  it('ignores empty and non-string entries', () => {
    expect(boundedCitations([null, undefined, '', 'https://a.example/1'], CAPS(3))).toEqual([
      'https://a.example/1',
    ]);
  });
});

describe('isSafeCitationUrl', () => {
  it('accepts a public http(s) page', () => {
    expect(isSafeCitationUrl('https://docs.example.com/guide?q=1#top')).toBe(true);
    expect(isSafeCitationUrl('http://news.example.co.uk/a')).toBe(true);
  });

  it.each([
    ['javascript:alert(1)', 'a script URL is never a link'],
    ['data:text/html,<b>x', 'a data URL is never a link'],
    ['mailto:someone@example.com', 'not a page'],
    ['/relative/path', 'not absolute'],
    ['https://user:secret@example.com/x', 'credentials must never be stored'],
    ['http://localhost/x', 'the reader’s own machine'],
    ['http://intranet/wiki', 'a single-label host is somebody’s internal name'],
    ['http://wiki.internal/x', 'an internal suffix'],
    ['http://printer.local/x', 'mDNS'],
    ['http://box.home.arpa/x', 'the home network of RFC 8375'],
    ['http://169.254.169.254/latest/meta-data', 'cloud metadata'],
    ['http://127.0.0.1/x', 'loopback'],
    ['http://127.1/x', 'loopback in a shorter spelling'],
    ['http://2130706433/x', 'loopback as one integer'],
    ['http://10.0.0.5/x', 'a private range'],
    ['http://[::1]/x', 'IPv6 loopback'],
    ['http://[::ffff:127.0.0.1]/x', 'IPv4-mapped loopback, which arrives as hex'],
    ['http://[::]/x', 'the unspecified address'],
    ['http://93.184.216.34/x', 'a bare address is not a published source'],
  ])('rejects %s (%s)', (url) => {
    expect(isSafeCitationUrl(url)).toBe(false);
  });

  it('is not fooled by case or a trailing root dot', () => {
    expect(isSafeCitationUrl('http://PRINTER.LOCAL./x')).toBe(false);
    expect(isSafeCitationUrl('https://Docs.Example.COM./x')).toBe(true);
  });
});

describe('readJsonBody', () => {
  function bodyThatFails(error: unknown): Response {
    return { json: () => Promise.reject(error) } as unknown as Response;
  }

  it('returns the parsed body', async () => {
    const response = { json: () => Promise.resolve({ ok: true }) } as unknown as Response;
    expect(await readJsonBody(response, undefined)).toEqual({ ok: true });
  });

  it('reports a body that is not JSON as no body, not as a failure', async () => {
    expect(await readJsonBody(bodyThatFails(new SyntaxError('bad json')), undefined)).toBeNull();
  });

  it('preserves the caller’s cancellation when the body transfer is aborted', async () => {
    // `fetch` resolves on the headers, so this is where a cancel lands once the
    // request itself is already through. Swallowing it would report a cancelled
    // run as an unavailable provider — which the module above pays to retry.
    const controller = new AbortController();
    controller.abort(new Error('scan cancelled by the customer'));

    await expect(
      readJsonBody(
        bodyThatFails(new DOMException('The operation was aborted', 'AbortError')),
        controller.signal,
      ),
    ).rejects.toThrow('scan cancelled by the customer');
  });

  it('reports a cancellation without an Error reason as a cancelled request', async () => {
    const controller = new AbortController();
    controller.abort('shutting down');

    await expect(
      readJsonBody(
        bodyThatFails(new DOMException('The operation was aborted', 'AbortError')),
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(AiRequestCancelledError);
  });
});
