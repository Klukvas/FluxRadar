// Small UI rules from the ui-quality and design-system review, pinned so they
// do not drift back.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthScreen } from './AuthScreen';

const STYLES = join(resolve(process.cwd()), 'src', 'styles');
const css = (name: string) => readFileSync(join(STYLES, name), 'utf8');

/** The body of the first rule whose selector line is exactly `selector {`. */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No rule for ${selector}`);
  return source.slice(start, source.indexOf('}', start));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('touch targets', () => {
  it('raises fields and the forgot-password link to a thumb-sized height on touch screens', () => {
    const base = css('base.css');
    const coarse = base.slice(base.indexOf('@media (pointer: coarse) {'));
    const block = coarse.slice(0, coarse.indexOf('\n}\n'));
    expect(block).toMatch(/\.control \{\s*min-height: 40px;/);
    expect(base).toMatch(
      /@media \(pointer: coarse\) \{\s*\.auth__text-action \{\s*min-height: 40px;/,
    );
  });
});

describe('caution surfaces', () => {
  it.each([
    ['account.css', '.verify-banner'],
    ['findings.css', '.report-block--warning'],
    ['print-report.css', '.print-note'],
  ])('%s %s paints with the --warn-* family', (file, selector) => {
    const body = ruleBody(css(file), selector);
    expect(body).toContain('var(--warn-line)');
    expect(body).toContain('var(--warn-fill)');
    expect(body).toContain('var(--warn-text)');
    expect(body).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe('loading placeholders', () => {
  it('stand still, with no gradient and no shimmer', () => {
    const base = css('base.css');
    for (const body of [
      ruleBody(base, '.skeleton-row'),
      ruleBody(base, '.skeleton-shell'),
      ruleBody(css('new-scan.css'), '.plan-card__skeleton'),
    ]) {
      expect(body).toContain('background: var(--plat-200);');
      expect(body).not.toMatch(/gradient|animation/);
    }
    expect(base).not.toContain('skeleton-shimmer');
  });
});

describe('the Google sign-in button', () => {
  it('says it is checking while its availability is unknown', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(
      <AuthScreen
        language="ru"
        onAuthed={() => Promise.resolve()}
        error={null}
        onError={() => {}}
        onBack={() => {}}
        initialMode="login"
        emailAction={null}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Проверяем вход через Google…');
  });
});
