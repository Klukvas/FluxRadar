import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// A request no test stubbed used to go to a real localhost:3310 and fail with
// ECONNREFUSED some time later, often in the middle of another file: the kind
// of timing-dependent noise that turns into flakes. Such a request now never
// leaves the process, and the test that made it fails by name. `vi.stubGlobal`
// saves and restores this guard, so a test's own mock is unaffected.
let unmockedRequests: readonly string[] = [];
globalThis.fetch = ((input: RequestInfo | URL) => {
  unmockedRequests = [...unmockedRequests, String(input instanceof Request ? input.url : input)];
  return Promise.reject(new TypeError(`Unmocked fetch in a test: ${String(input)}`));
}) as typeof fetch;

afterEach(() => {
  const made = unmockedRequests;
  unmockedRequests = [];
  if (made.length > 0) {
    throw new Error(`This test made requests no mock answered:\n  ${made.join('\n  ')}`);
  }
});

// One happy-dom window serves every test in a file, so its session storage is
// shared state between them. The add-a-site form keeps a draft there so a
// reload does not lose a half-written profile (`profile-draft-storage.ts`),
// which means a test that types into that form would hand the next test a
// pre-filled one. Emptied after every test, here rather than in each file, so
// the isolation does not depend on remembering it.
afterEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    // A test may have replaced the storage with one that throws; nothing to do.
  }
});
