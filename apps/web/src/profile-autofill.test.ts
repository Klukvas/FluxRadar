import { describe, expect, it } from 'vitest';

import {
  autofillOriginFor,
  autofillProblemMessage,
  autofillStatusMessage,
  contextProposalFor,
  untouchedAutoValues,
  type AutofillFormState,
  type ProfileContextLabel,
} from './profile-autofill';

const NOTHING_WRITTEN: Readonly<Record<ProfileContextLabel, string>> = {
  businessType: '',
  businessDescription: '',
  offerings: '',
  operatingRegion: '',
  targetLanguages: '',
  targetAudience: '',
};

function form(overrides: Partial<AutofillFormState> = {}): AutofillFormState {
  return {
    address: 'clinic.example',
    editing: false,
    lastAttemptedOrigin: null,
    nameIsOwners: false,
    emptyContextFields: 6,
    ...overrides,
  };
}

describe('when the form may read the site by itself', () => {
  it('reads a complete address, normalized the way the profile stores it', () => {
    expect(autofillOriginFor(form({ address: ' https://www.clinic.example/pricing?ref=1 ' }))).toBe(
      'https://www.clinic.example',
    );
  });

  it('leaves a half-typed address alone', () => {
    expect(autofillOriginFor(form({ address: 'clinic' }))).toBeNull();
    expect(autofillOriginFor(form({ address: '' }))).toBeNull();
    expect(autofillOriginFor(form({ address: 'mailto:hi@clinic.example' }))).toBeNull();
  });

  it('does not ask again about the address it is already holding an answer for', () => {
    expect(autofillOriginFor(form({ lastAttemptedOrigin: 'https://clinic.example' }))).toBeNull();
    expect(autofillOriginFor(form({ lastAttemptedOrigin: 'https://other.example' }))).toBe(
      'https://clinic.example',
    );
  });

  it('never reads for a saved profile open in the form', () => {
    expect(autofillOriginFor(form({ editing: true }))).toBeNull();
  });

  it('does not read a site whose answer could change nothing', () => {
    expect(autofillOriginFor(form({ nameIsOwners: true, emptyContextFields: 0 }))).toBeNull();
    // One empty field is still worth an answer, and so is an unwritten name.
    expect(autofillOriginFor(form({ nameIsOwners: true, emptyContextFields: 1 }))).toBe(
      'https://clinic.example',
    );
    expect(autofillOriginFor(form({ nameIsOwners: false, emptyContextFields: 0 }))).toBe(
      'https://clinic.example',
    );
  });
});

describe('what a proposal is allowed to touch', () => {
  it('fills the empty fields the page stated and names the ones it did not', () => {
    const proposal = contextProposalFor({ industry: 'Dentist', region: 'Kyiv' }, NOTHING_WRITTEN);

    expect(proposal.fill).toEqual([
      { label: 'businessType', value: 'Dentist' },
      { label: 'operatingRegion', value: 'Kyiv' },
    ]);
    expect(proposal.missing).toEqual([
      'businessDescription',
      'offerings',
      'targetLanguages',
      'targetAudience',
    ]);
  });

  it('leaves a field the owner wrote alone, and does not call it missing', () => {
    const proposal = contextProposalFor(
      { industry: 'Dentist', targetAudience: 'Families' },
      { ...NOTHING_WRITTEN, businessType: 'Marketing agency', targetAudience: '   ' },
    );

    expect(proposal.fill).toEqual([{ label: 'targetAudience', value: 'Families' }]);
    expect(proposal.missing).not.toContain('businessType');
    // Whitespace is not an answer, so that field is still the proposal's to fill.
    expect(proposal.missing).not.toContain('targetAudience');
  });

  it('keeps only the target languages this product can audit in', () => {
    expect(contextProposalFor({ targetLanguages: 'en, uk, de' }, NOTHING_WRITTEN).fill).toEqual([
      { label: 'targetLanguages', value: 'English, Ukrainian' },
    ]);
    // A page published only in a language the picker has no entry for states
    // nothing this form can show, so it reads as unstated rather than as empty.
    const unsupported = contextProposalFor({ targetLanguages: 'ja' }, NOTHING_WRITTEN);
    expect(unsupported.fill).toEqual([]);
    expect(unsupported.missing).toContain('targetLanguages');
  });
});

describe('which values in the form are the form’s own', () => {
  it('keeps the ones still standing exactly as the read left them', () => {
    expect(
      untouchedAutoValues(
        { name: 'Public clinic', businessType: 'Dentist', operatingRegion: 'Kyiv' },
        {
          name: 'Public clinic',
          context: { ...NOTHING_WRITTEN, businessType: 'Dentist', operatingRegion: 'Kyiv' },
        },
      ),
    ).toEqual({ name: 'Public clinic', businessType: 'Dentist', operatingRegion: 'Kyiv' });
  });

  it('gives up a value the owner has since edited or emptied, name included', () => {
    expect(
      untouchedAutoValues(
        { name: 'Public clinic', businessType: 'Dentist', operatingRegion: 'Kyiv' },
        {
          name: 'Our landing page',
          context: { ...NOTHING_WRITTEN, businessType: 'Dentist, orthodontist' },
        },
      ),
    ).toEqual({});
  });

  it('claims nothing when the form has written nothing', () => {
    expect(untouchedAutoValues({}, { name: 'Typed by hand', context: NOTHING_WRITTEN })).toEqual(
      {},
    );
  });
});

describe('what the owner is told when the read did not happen', () => {
  it('gives a refused crawler the advice that fixes it', () => {
    const denied = autofillProblemMessage('SITE_ACCESS_DENIED', 'en');

    expect(denied).toContain('We could not read this site, so nothing was filled in.');
    expect(denied).toContain('WAF or bot protection');
    expect(denied).toContain('save the profile and describe the site yourself');
  });

  it('separates robots.txt, no answer and an unreadable page', () => {
    expect(autofillProblemMessage('SITE_BLOCKED_BY_ROBOTS', 'en')).toContain('robots.txt');
    expect(autofillProblemMessage('SITE_UNREACHABLE', 'en')).toContain(
      'could not reach your site at all',
    );
    expect(autofillProblemMessage('SITE_BAD_RESPONSE', 'en')).toContain(
      'not with a page we could read',
    );
  });

  it('says nothing about our network for any other failure', () => {
    const neutral = 'Could not read public details from this site. You can still save it manually.';

    expect(autofillProblemMessage(null, 'en')).toBe(neutral);
    expect(autofillProblemMessage('VALIDATION', 'en')).toBe(neutral);
    expect(autofillProblemMessage('INTERNAL', 'en')).toBe(neutral);
  });

  it('answers in the reader’s language', () => {
    expect(autofillProblemMessage('SITE_ACCESS_DENIED', 'uk')).toContain(
      'Ми не змогли прочитати цей сайт',
    );
    expect(autofillProblemMessage(null, 'uk')).toContain('Не вдалося прочитати публічні дані');
  });
});

describe('the status line of an automatic read', () => {
  it('holds one sentence per phase and nothing at rest', () => {
    expect(autofillStatusMessage({ kind: 'idle' }, 'en')).toBeNull();
    expect(autofillStatusMessage({ kind: 'checking' }, 'en')).toContain(
      'Checking whether we can read this site',
    );
    expect(autofillStatusMessage({ kind: 'filled' }, 'en')).toContain(
      'Filled in what this site’s homepage states',
    );
    expect(autofillStatusMessage({ kind: 'nothing' }, 'en')).toContain(
      'states nothing we could reuse',
    );
  });

  it('resolves a refusal when it is read, not when it arrived', () => {
    const status = { kind: 'problem', code: 'SITE_ACCESS_DENIED' } as const;

    expect(autofillStatusMessage(status, 'uk')).toBe(
      autofillProblemMessage('SITE_ACCESS_DENIED', 'uk'),
    );
    expect(autofillStatusMessage(status, 'en')).not.toBe(autofillStatusMessage(status, 'uk'));
  });
});
