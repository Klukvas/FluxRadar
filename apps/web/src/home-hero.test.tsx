// The home page's first screen, as a small-business owner meets it: a plain
// title, the site form, what happens next and what it costs, and an example
// report beside it. What it must not bring back is the audit-station scenery —
// the terminal, the counters, the running ticker — that read as a tool for
// programmers.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXAMPLE_REPORT_PATH } from './app-routes';
import { HomeScreen } from './HomeScreen';
import { copy, type Language } from './i18n';
import { BASIC_PRICE } from './tariff-prices';

afterEach(() => {
  cleanup();
});

const LANGUAGES: readonly Language[] = ['en', 'uk'];

function renderHome(language: Language, onStartSite = vi.fn()) {
  render(
    <HomeScreen
      signedIn={false}
      onStart={vi.fn()}
      onStartSite={onStartSite}
      onChoosePlan={vi.fn()}
      onLogin={vi.fn()}
      onRegister={vi.fn()}
      onOpenWorkspace={vi.fn()}
      language={language}
      onLanguageChange={vi.fn()}
      authOpen={false}
      authAction={null}
      authMode="register"
      authError={null}
      onAuthError={vi.fn()}
      onAuthed={vi.fn(async () => undefined)}
      onCloseAuth={vi.fn()}
    />,
  );
  return onStartSite;
}

function hero(): HTMLElement {
  const title = screen.getByRole('heading', { level: 1 });
  return title.closest('section') as HTMLElement;
}

describe('home hero', () => {
  it.each<[Language, string]>([
    ['en', 'Online website audit: SEO, AI visibility and what to fix first'],
    ['uk', 'Онлайн-аудит сайту: SEO, видимість для ШІ та що виправити першим'],
  ])('titles the page in plain words (%s)', (language, title) => {
    renderHome(language);
    const heading = screen.getByRole('heading', { level: 1, name: title });
    expect(heading).toHaveAttribute('id', 'home-title');
    // One sentence, read as written: no typed characters, no hidden copy.
    expect(heading).not.toHaveAttribute('aria-label');
    expect(heading.textContent).toBe(title);
  });

  // The dark panel is what keeps the copy's small text at AA; the platinum
  // example window beside it must not take it.
  it('puts the copy column on the dark panel and leaves the example window light', () => {
    renderHome('en');
    const column = screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement;
    expect(column).toHaveClass('home-hero__panel');
    const window = screen.getByRole('region', { name: 'Example report' });
    expect(window).not.toHaveClass('home-hero__panel');
    expect(window.querySelector('.home-hero__panel')).toBeNull();
  });

  it.each(LANGUAGES)('shows no terminal, counters or ticker (%s)', (language) => {
    renderHome(language);
    const page = document.body;
    expect(page.querySelector('.home__instrument, .terminal, .home__ticker')).toBeNull();
    expect(page.querySelector('.home__proof, .home__account-label')).toBeNull();
    expect(page.querySelector('.home__type-char')).toBeNull();
    // The menu bar keeps the product's name; the first screen under it is the
    // account bar and the hero, and neither speaks in station labels.
    const firstScreen = `${page.querySelector('.home__account-bar')?.textContent ?? ''} ${hero().textContent ?? ''}`;
    expect(firstScreen).not.toMatch(/AUDIT STATION|СТАНЦІЯ АУДИТУ|FLUXLAB|One URL|Одна адреса/);
  });

  it('keeps the account buttons in the bar above the hero', () => {
    renderHome('en');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it.each<[Language, readonly string[]]>([
    ['en', ['No passwords or site access', 'No subscription', 'Report in English or Ukrainian']],
    ['uk', ['Без паролів і доступу до сайту', 'Без підписки', 'Звіт українською']],
  ])('lists what the visitor can rely on (%s)', (language, items) => {
    renderHome(language);
    const lists = within(hero()).getAllByRole('list');
    const trust = lists.find((list) => list.closest('.home-hero__window') === null);
    // Explicit, because Safari drops the semantics of an unstyled list.
    expect(trust).toHaveAttribute('role', 'list');
    const listItems = within(trust as HTMLElement).getAllByRole('listitem');
    // The tick is decoration: drawn for the eye, hidden from a screen reader.
    expect(listItems.map((item) => item.textContent)).toEqual(items.map((item) => `✓${item}`));
    for (const item of listItems) {
      expect(item.querySelector('.home-hero__check')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  // The note names the cheapest paid report's price, read from the same table
  // the tariff cards are, so a price change cannot leave the hero behind.
  it.each(LANGUAGES)('prices the full report from the tariff table (%s)', (language) => {
    renderHome(language);
    const note = within(hero()).getByText(new RegExp(BASIC_PRICE.replace('$', '\\$')));
    expect(note.textContent).not.toContain('{price}');
    expect(copy[language].home.hero.note).toContain('{price}');
    expect(copy[language].home.hero.note).not.toMatch(/\$\d/);
  });

  it.each<[Language, string, string]>([
    ['en', 'Example report', 'Full example'],
    ['uk', 'Приклад звіту', 'Весь приклад'],
  ])('shows an example report window beside the form (%s)', (language, name, linkName) => {
    renderHome(language);
    const t = copy[language].home.hero.example;
    const window = screen.getByRole('region', { name });
    expect(within(window).getByText(t.site)).toBeInTheDocument();
    expect(within(window).getByText(t.meta)).toBeInTheDocument();
    expect(within(window).getByRole('list')).toHaveAttribute('role', 'list');
    const findings = within(window).getAllByRole('listitem');
    expect(findings).toHaveLength(3);
    t.findings.forEach((finding, index) => {
      const item = findings[index] as HTMLElement;
      expect(item).toHaveTextContent(finding.chip);
      expect(item).toHaveTextContent(finding.problem);
      expect(item).toHaveTextContent(finding.action);
    });
    expect(findings.map((item) => item.querySelector('.home-hero__chip')?.textContent)).toEqual(
      language === 'en'
        ? ['FIX FIRST', 'WORTH FIXING', 'WORTH FIXING']
        : ['ВИПРАВИТИ ПЕРШИМ', 'ВАРТО ВИПРАВИТИ', 'ВАРТО ВИПРАВИТИ'],
    );
    expect(within(window).getByText(t.disclaimer)).toBeInTheDocument();
    expect(within(window).getByRole('link', { name: new RegExp(linkName) })).toHaveAttribute(
      'href',
      language === 'uk' ? '/uk/example-report' : EXAMPLE_REPORT_PATH,
    );
  });

  it('uses a reserved example domain for the made-up site', () => {
    for (const language of LANGUAGES) {
      expect(copy[language].home.hero.example.site).toMatch(/\.example$/);
    }
  });

  it('starts the check with the address the visitor typed', () => {
    const onStartSite = renderHome('en');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your website address' }), {
      target: { value: 'mysalon.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check my site' }));
    expect(onStartSite).toHaveBeenCalledWith('https://mysalon.com');
  });

  it('starts with no site when the field is left empty', () => {
    const onStartSite = renderHome('uk');
    expect(screen.getByRole('textbox', { name: 'Адреса вашого сайту' })).toHaveAttribute(
      'placeholder',
      'наприклад, mysalon.com.ua',
    );
    fireEvent.click(within(hero()).getByRole('button', { name: 'Перевірте свій сайт' }));
    expect(onStartSite).toHaveBeenCalledWith(null);
  });

  it('refuses an address that is not a public site, without starting', () => {
    const onStartSite = renderHome('en');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your website address' }), {
      target: { value: 'not a site' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check my site' }));
    expect(onStartSite).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a public website address');
  });

  it.each<[Language, string]>([
    ['en', 'Prices and what the report includes'],
    ['uk', 'Ціни та що входить у звіт'],
  ])('scrolls to the pricing block from the hero (%s)', (language, name) => {
    renderHome(language);
    expect(within(hero()).getByRole('link', { name: new RegExp(name) })).toHaveAttribute(
      'href',
      '#pricing',
    );
    expect(document.getElementById('pricing')).not.toBeNull();
  });
});
