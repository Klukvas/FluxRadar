// Why a search provider produced no figures, as the document states it.
//
// The defect this suite exists for: a Ukrainian report with nothing connected
// printed the Sections table's reason in Ukrainian and, three lines below it, the
// provider's own English sentence — "Google is not connected for this workspace."
// under "Пошукові дані". The last two tests are the guard: they take both state
// vocabularies from the producers and require a sentence for every value, so a
// state added there fails here rather than reaching a customer's file in English.

import { describe, expect, it } from 'vitest';

import { BING_DATA_STATES } from '../../integrations/bing/types.ts';
import { GOOGLE_DATA_STATES } from '../../integrations/google/types.ts';
import { bingStateText, googleStateText } from './provider-state.ts';

const STORED_ENGLISH = 'Google is not connected for this workspace.';

describe('googleStateText', () => {
  it('says why Google has no figures in the reader’s language, not the API’s', () => {
    const service = { state: 'not_connected', detail: STORED_ENGLISH };

    expect(googleStateText(service, 'en')).toBe(STORED_ENGLISH);
    expect(googleStateText(service, 'uk')).toBe(
      'Google не підключено для цього робочого простору.',
    );
    expect(googleStateText(service, 'uk')).not.toContain('Google is not connected');
  });

  it('quotes the stored sentence for a state this build does not know', () => {
    const service = { state: 'quota_exhausted', detail: 'Google ran out of quota today.' };

    expect(googleStateText(service, 'uk')).toBe('Google ran out of quota today.');
  });
});

describe('bingStateText', () => {
  it('says why Bing has no figures in the reader’s language', () => {
    const service = {
      state: 'not_verified',
      detail: 'Bing has not verified ownership of this site yet.',
    };

    expect(bingStateText(service, 'uk')).toBe('Bing ще не підтвердив право власності на цей сайт.');
    expect(bingStateText(service, 'en')).toBe(service.detail);
  });

  it('quotes the stored sentence for a state this build does not know', () => {
    const service = { state: 'rate_limited', detail: 'Bing asked us to slow down.' };

    expect(bingStateText(service, 'uk')).toBe('Bing asked us to slow down.');
  });
});

describe('the providers’ state vocabulary', () => {
  it.each(GOOGLE_DATA_STATES)('explains the Google state %s in both languages', (state) => {
    const service = { state, detail: STORED_ENGLISH };
    const uk = googleStateText(service, 'uk');

    expect(googleStateText(service, 'en')).not.toBe('');
    expect(uk).not.toBe('');
    // Not the stored English, and not the token either.
    expect(uk).not.toBe(STORED_ENGLISH);
    expect(uk).not.toContain(state);
  });

  it.each(BING_DATA_STATES)('explains the Bing state %s in both languages', (state) => {
    const service = { state, detail: STORED_ENGLISH };
    const uk = bingStateText(service, 'uk');

    expect(bingStateText(service, 'en')).not.toBe('');
    expect(uk).not.toBe(STORED_ENGLISH);
    expect(uk).not.toContain(state);
  });
});
