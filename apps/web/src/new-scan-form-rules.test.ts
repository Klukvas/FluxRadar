import { describe, expect, it } from 'vitest';

import { expertSettingsChanged } from './new-scan-form-rules';
import { DEFAULT_SCOPE_FORM } from './scan-scope';

// Whether "For experienced users" has to open by itself: anything in it that
// differs from what a new profile starts on must be on screen before a launch.
describe('expertSettingsChanged', () => {
  it('stays folded on the defaults', () => {
    expect(expertSettingsChanged(DEFAULT_SCOPE_FORM, true, 'ua')).toBe(false);
  });

  // Before the server names its default, a stored country cannot be told apart
  // from it; once it has, only a different one counts.
  it('counts a country only against the default the server named', () => {
    const inGermany = { ...DEFAULT_SCOPE_FORM, egressLocation: 'de' };

    expect(expertSettingsChanged(inGermany, true, null)).toBe(false);
    expect(expertSettingsChanged(inGermany, true, 'ua')).toBe(true);
    expect(expertSettingsChanged({ ...DEFAULT_SCOPE_FORM, egressLocation: 'ua' }, true, 'ua')).toBe(
      false,
    );
  });

  // Free shows only the user agent in the block, so only it counts there.
  it('counts a mobile user agent on Free, and nothing Free does not show', () => {
    expect(expertSettingsChanged({ ...DEFAULT_SCOPE_FORM, userAgent: 'mobile' }, false, 'ua')).toBe(
      true,
    );
    expect(
      expertSettingsChanged({ ...DEFAULT_SCOPE_FORM, includeSubdomains: true }, false, 'ua'),
    ).toBe(false);
  });

  // An explicit number is the owner's own limit even when it equals the plan's.
  it('counts an explicit page limit, even one equal to the plan limit', () => {
    expect(expertSettingsChanged({ ...DEFAULT_SCOPE_FORM, maxPages: '5000' }, true, 'ua')).toBe(
      true,
    );
  });

  it('counts an ignored robots.txt and a cleared depth', () => {
    expect(expertSettingsChanged({ ...DEFAULT_SCOPE_FORM, respectRobots: false }, true, 'ua')).toBe(
      true,
    );
    expect(expertSettingsChanged({ ...DEFAULT_SCOPE_FORM, maxDepth: '' }, true, 'ua')).toBe(true);
  });
});
