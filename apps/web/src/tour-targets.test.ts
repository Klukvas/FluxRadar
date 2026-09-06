import { afterEach, describe, expect, it } from 'vitest';

import { resolveTourTarget, tourTargets } from './tour-targets';

// The header is one markup tree rendered three different ways: a desktop tab
// strip, a collapsed mobile bar with a burger, and an open mobile sheet. These
// tests pin the element the spotlight anchors to in each of those states.

function renderHeader(tabsDisplay: string): HTMLElement {
  document.body.innerHTML = `
    <nav data-tour-target="${tourTargets.workspaceHeader}">
      <button id="burger">menu</button>
      <div id="tabs" data-tour-target="${tourTargets.workspaceTabs}" style="display: ${tabsDisplay}">
        <button id="profiles">Profiles</button>
        <button id="scan">Scan</button>
      </div>
    </nav>
  `;
  const header = document.body.querySelector('nav');
  if (header === null) throw new Error('expected the header to render');
  return header;
}

const headerCandidates = [tourTargets.workspaceTabs, tourTargets.workspaceHeader];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveTourTarget', () => {
  it('highlights the whole header on desktop, where the tab strip has no box of its own', () => {
    const header = renderHeader('contents');

    const resolved = resolveTourTarget(headerCandidates);

    expect(resolved).toBe(header);
    expect(resolved?.querySelector('#profiles')).not.toBeNull();
    expect(resolved?.querySelector('#scan')).not.toBeNull();
  });

  it('highlights the header, including the burger, when the mobile menu is closed', () => {
    const header = renderHeader('none');

    const resolved = resolveTourTarget(headerCandidates);

    expect(resolved).toBe(header);
    expect(resolved?.querySelector('#burger')).not.toBeNull();
  });

  it('highlights the open mobile sheet while it covers the screen', () => {
    renderHeader('flex');

    const resolved = resolveTourTarget(headerCandidates);

    expect(resolved?.id).toBe('tabs');
  });

  it('skips candidates that are not mounted', () => {
    const header = renderHeader('none');

    expect(resolveTourTarget(['not-rendered', tourTargets.workspaceHeader])).toBe(header);
    expect(resolveTourTarget(['not-rendered'])).toBeNull();
  });
});
