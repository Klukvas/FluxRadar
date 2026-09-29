import { describe, expect, it } from 'vitest';

import {
  extractProfileSuggestions,
  PROFILE_SUGGESTIONS_FETCH_OPTIONS,
} from './profile-suggestions.ts';

describe('public profile suggestions', () => {
  it('uses only visible homepage metadata and never invents region or audience', () => {
    expect(
      extractProfileSuggestions(`
        <html lang="uk-UA"><head><title>Clinic</title>
        <meta name="description" content="Care for local families"></head>
        <body><script>secret internal audience</script><main><h2>Dental implants</h2><h3>Emergency care</h3></main></body></html>
      `),
    ).toEqual({
      name: 'Clinic',
      businessDescription: 'Care for local families',
      offerings: 'Dental implants, Emergency care',
      targetLanguages: 'uk',
    });
  });

  it('keeps the single homepage read bounded', () => {
    expect(PROFILE_SUGGESTIONS_FETCH_OPTIONS).toEqual({
      method: 'GET',
      timeoutMs: 8_000,
      maxBodyBytes: 256 * 1024,
      maxRedirects: 3,
      headers: { 'user-agent': 'FluxRadarProfileAssistant/1.0' },
    });
  });

  it('bounds extracted text and ignores executable markup', () => {
    const oversized = 'x'.repeat(2_000);
    expect(
      extractProfileSuggestions(
        `<html><head><title>${oversized}</title><meta name="description" content="${oversized}"></head><body><script>hidden</script><h2>${oversized}</h2></body></html>`,
      ),
    ).toEqual({
      name: 'x'.repeat(120),
      businessDescription: 'x'.repeat(800),
      offerings: 'x'.repeat(800),
    });
  });
});
