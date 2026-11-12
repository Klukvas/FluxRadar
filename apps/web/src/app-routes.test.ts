import { afterEach, describe, expect, it } from 'vitest';

import { readInitialRoute } from './app-routes';

function routeAt(url: string) {
  window.history.replaceState(null, '', url);
  return readInitialRoute();
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('readInitialRoute for addresses that name no page', () => {
  it.each(['/nope-404', '/uk/nope', '/scans', '/scans/a/b/c', '/blog/anything', '/profiles/extra'])(
    'reads %s as "page not found", not as the home page',
    (path) => {
      expect(routeAt(path).screen).toBe('not-found');
    },
  );

  it.each(['/', '/index.html'])('reads %s as the home page', (path) => {
    expect(routeAt(path).screen).toBe('home');
  });

  it('keeps a mailed link on the sign-in screen even when its path is unknown', () => {
    expect(routeAt('/whatever?reset_token=abc').screen).toBe('auth');
  });
});

describe('readInitialRoute for the sign-in address', () => {
  it('opens the sign-in dialog on /login, with or without a trailing slash', () => {
    expect(routeAt('/login').screen).toBe('auth');
    expect(routeAt('/login/').screen).toBe('auth');
  });

  it('keeps the private scan addresses on their screens', () => {
    expect(routeAt('/scans/abc').screen).toBe('scan');
    expect(routeAt('/scans/abc/issues').screen).toBe('issues');
    expect(routeAt('/scans/abc/report').screen).toBe('print');
  });
});
