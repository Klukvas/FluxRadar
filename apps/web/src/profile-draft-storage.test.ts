// What the browser may keep of a half-written profile, and everything it must
// refuse. The slot is shared with every other script on this origin and
// survives a reload, so each case here is a way the form could be handed
// something it should not write into its own fields.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProfileContextLabel } from './profile-autofill';
import {
  PROFILE_DRAFT_MAX_FIELD,
  PROFILE_DRAFT_TTL_MS,
  clearProfileDraft,
  isEmptyProfileDraft,
  readProfileDraft,
  storeProfileDraft,
  type ProfileDraft,
} from './profile-draft-storage';

const STORAGE_KEY = 'fluxradar.profileDraft';
const NOW = Date.parse('2026-10-09T12:00:00.000Z');

const emptyContext: Record<ProfileContextLabel, string> = {
  businessType: '',
  businessDescription: '',
  offerings: '',
  operatingRegion: '',
  targetLanguages: '',
  targetAudience: '',
};

function draft(overrides: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
    accountId: 'account-1',
    address: 'clinic.example',
    name: 'Public clinic',
    suggestedName: '',
    context: { ...emptyContext, businessType: 'Dentist' },
    competitors: 'Other clinic',
    applied: { businessType: 'Dentist' },
    pendingOrigin: null,
    askedOrigin: 'https://clinic.example',
    savedAt: NOW - 1_000,
    ...overrides,
  };
}

/** A record as it sits in storage, so a malformed one can be written directly. */
function store(record: unknown): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('keeping a draft across a reload', () => {
  it('reads back everything the form needs to carry on', () => {
    storeProfileDraft(draft({ pendingOrigin: 'https://clinic.example' }));

    expect(readProfileDraft('account-1', NOW)).toEqual(
      draft({ pendingOrigin: 'https://clinic.example' }),
    );
  });

  it('has nothing to read when nothing was kept', () => {
    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it('replaces the previous draft rather than leaving two', () => {
    storeProfileDraft(draft());
    storeProfileDraft(draft({ address: 'studio.example', name: 'Public studio' }));

    expect(readProfileDraft('account-1', NOW)?.name).toBe('Public studio');
  });

  it('is forgotten once cleared', () => {
    storeProfileDraft(draft());
    clearProfileDraft();

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('survives a store that refuses to be written', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(
      new Proxy(window.sessionStorage, {
        get: (target, property) =>
          property === 'setItem'
            ? () => {
                throw new DOMException('Storage full', 'QuotaExceededError');
              }
            : Reflect.get(target, property),
      }),
    );

    // The form in front of the owner still works; it just will not come back.
    expect(() => storeProfileDraft(draft())).not.toThrow();
  });

  it('reads nothing from a store that refuses to be read', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(
      new Proxy(window.sessionStorage, {
        get: (target, property) =>
          property === 'getItem'
            ? () => {
                throw new DOMException('Storage blocked', 'SecurityError');
              }
            : Reflect.get(target, property),
      }),
    );

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });
});

describe('a draft belongs to one account and one afternoon', () => {
  it('declines a draft another account left in this browser', () => {
    storeProfileDraft(draft({ accountId: 'account-2' }));

    expect(readProfileDraft('account-1', NOW)).toBeNull();
    // And drops it, so it cannot be offered to anyone else either.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps a draft written inside its lifetime', () => {
    storeProfileDraft(draft({ savedAt: NOW - PROFILE_DRAFT_TTL_MS }));

    expect(readProfileDraft('account-1', NOW)).not.toBeNull();
  });

  it('drops a draft older than its lifetime', () => {
    storeProfileDraft(draft({ savedAt: NOW - PROFILE_DRAFT_TTL_MS - 1 }));

    expect(readProfileDraft('account-1', NOW)).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('drops a draft stamped in the future', () => {
    storeProfileDraft(draft({ savedAt: NOW + 1 }));

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it.each([
    ['a timestamp that is not a number', { savedAt: '2026-10-09' }],
    ['a fractional timestamp', { savedAt: NOW - 0.5 }],
    ['a timestamp of zero', { savedAt: 0 }],
  ])('drops a draft with %s', (_label, overrides) => {
    store({ ...draft(), ...overrides });

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it('drops a draft with no timestamp at all', () => {
    const unstamped: Record<string, unknown> = { ...draft() };
    delete unstamped.savedAt;
    store(unstamped);

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });
});

describe('every field is validated rather than repaired', () => {
  it.each([
    ['the stored value is not an object', '"just a string"'],
    ['the stored value is not JSON at all', 'not-json'],
  ])('drops a draft when %s', (_label, raw) => {
    window.sessionStorage.setItem(STORAGE_KEY, raw);

    expect(readProfileDraft('account-1', NOW)).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it.each([
    ['address', { address: 42 }],
    ['name', { name: null }],
    ['suggestedName', { suggestedName: ['a'] }],
    ['competitors', { competitors: { 0: 'a' } }],
    ['context', { context: 'Dentist' }],
    ['applied', { applied: 'Dentist' }],
  ])('drops a draft whose %s is not text', (_label, overrides) => {
    store({ ...draft(), ...overrides });

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it('drops a draft whose context field is not text', () => {
    store({ ...draft(), context: { ...emptyContext, offerings: 7 } });

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it('fills in a context field the stored record simply lacks', () => {
    const partial: Record<string, unknown> = { ...emptyContext };
    delete partial.targetAudience;
    store({ ...draft(), context: { ...partial, businessType: 'Dentist' } });

    expect(readProfileDraft('account-1', NOW)?.context).toEqual({
      ...emptyContext,
      businessType: 'Dentist',
    });
  });

  it.each([
    ['one field', { name: 'n'.repeat(PROFILE_DRAFT_MAX_FIELD + 1) }],
    ['a context field', { context: { ...emptyContext, offerings: 'o'.repeat(2_001) } }],
    ['a recorded value', { applied: { businessType: 'd'.repeat(2_001) } }],
  ])('drops a draft whose %s is longer than the cap', (_label, overrides) => {
    store({ ...draft(), ...overrides });

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it('keeps a field exactly at the cap', () => {
    storeProfileDraft(draft({ name: 'n'.repeat(PROFILE_DRAFT_MAX_FIELD) }));

    expect(readProfileDraft('account-1', NOW)?.name).toHaveLength(PROFILE_DRAFT_MAX_FIELD);
  });

  // The provenance decides which values a later address may take back. A key
  // this version does not write is not a field, so it is left behind rather
  // than carried into a map the form indexes by field name.
  it('keeps only the fields a read can write, out of a recorded map', () => {
    store({ ...draft(), applied: { businessType: 'Dentist', somethingElse: 'x', name: 'Clinic' } });

    expect(readProfileDraft('account-1', NOW)?.applied).toEqual({
      businessType: 'Dentist',
      name: 'Clinic',
    });
  });
});

// A restored origin is resumed by sending a request to it. Anything that is not
// an absolute http(s) origin in that slot would make "carry on where you left
// off" a fetch at an address the owner never typed.
describe('a resumable origin', () => {
  it.each([
    ['a path on the origin', 'https://clinic.example/pricing'],
    ['a javascript: URL', 'javascript:fetch("https://attacker.example")'],
    ['a data: URL', 'data:text/html,<script>1</script>'],
    ['a file: URL', 'file:///etc/passwd'],
    ['a bare host', 'clinic.example'],
    ['an empty string', ''],
    ['a number', 1],
  ])('drops a draft whose pending read is %s', (_label, pendingOrigin) => {
    store({ ...draft(), pendingOrigin });

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it('drops a draft whose answered address is not an origin either', () => {
    store({ ...draft(), askedOrigin: 'https://clinic.example/about' });

    expect(readProfileDraft('account-1', NOW)).toBeNull();
  });

  it.each([
    ['https', 'https://clinic.example'],
    ['http', 'http://clinic.example'],
    ['a port', 'http://clinic.example:8080'],
    ['nothing pending', null],
  ])('keeps %s', (_label, pendingOrigin) => {
    storeProfileDraft(draft({ pendingOrigin }));

    expect(readProfileDraft('account-1', NOW)?.pendingOrigin).toBe(pendingOrigin);
  });
});

describe('a draft worth keeping at all', () => {
  it('is nothing when every field is blank and no read is owed', () => {
    expect(
      isEmptyProfileDraft({
        address: '',
        name: '',
        context: emptyContext,
        competitors: '',
        pendingOrigin: null,
      }),
    ).toBe(true);
  });

  it('counts whitespace as blank', () => {
    expect(
      isEmptyProfileDraft({
        address: '   ',
        name: '\n',
        context: emptyContext,
        competitors: ' ',
        pendingOrigin: null,
      }),
    ).toBe(true);
  });

  it.each([
    ['an address', { address: 'clinic.example' }],
    ['a name', { name: 'Public clinic' }],
    ['a competitor', { competitors: 'Other clinic' }],
    ['a context field', { context: { ...emptyContext, offerings: 'Implants' } }],
    // A blank form with a read in flight is still work in progress: that read
    // is the thing a reload has to pick back up.
    ['a read in flight', { pendingOrigin: 'https://clinic.example' }],
  ])('is worth keeping once it holds %s', (_label, overrides) => {
    expect(
      isEmptyProfileDraft({
        address: '',
        name: '',
        context: emptyContext,
        competitors: '',
        pendingOrigin: null,
        ...overrides,
      }),
    ).toBe(false);
  });
});
