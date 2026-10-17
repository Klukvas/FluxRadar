// User research (a salon owner, a dental admin, a freelancer, a lawyer) read the
// workspace as accounting: «Профілі сайтів», «Зареєстровані публічні джерела»,
// «Додати профіль» and a paragraph about "configuration". The screen now says
// "site" and asks plainly, the button on a site says it checks that site, the
// add button is quieter once a site exists, and the optional rows say so.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { App } from './App';
import { saveCookieConsent } from './browser-consent';
import { DesktopScreen } from './DesktopScreen';
import { AddSiteToggle } from './ProfileRow';

const NOOP_ASYNC = () => Promise.resolve();
const salon: SiteProfile = { id: 'salon', name: 'Salon', domain: 'https://mysalon.com.ua' };
const studio: SiteProfile = { id: 'studio', name: 'Studio', domain: 'https://studio.example' };
const TITLEBAR = { selector: '.window__titlebar > span' };
const PANEL_LABEL = { selector: '.panel__label' };

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// Every side panel of the workspace reads the API on mount; an empty answer is
// enough for a test about words.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(envelope(null))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

function renderDesktop(language: 'en' | 'uk', profiles: readonly SiteProfile[]) {
  render(
    <DesktopScreen
      profiles={profiles}
      onRefresh={NOOP_ASYNC}
      onProfileDeleted={() => {}}
      onSelectProfile={() => {}}
      onNewScan={() => {}}
      onOpenScan={() => {}}
      onRetryScan={NOOP_ASYNC}
      onError={() => {}}
      onNotice={() => {}}
      onOnboarding={() => {}}
      onOpenIntegrations={() => {}}
      language={language}
    />,
  );
}

function rowOf(name: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.profile-row')].find(
    (candidate) => within(candidate).queryByText(name) !== null,
  );
  if (row === undefined) throw new Error(`expected a row for ${name}`);
  return row;
}

describe('the shared menu tab', () => {
  it.each([
    ['en', 'My sites', 'Profiles'],
    ['uk', 'Мої сайти', 'Профілі'],
  ] as const)('reads as the owner’s sites in %s', async (language, label, old) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path === '/auth/me') return Promise.resolve(envelope({ accountId: 'a', email: 'o@x' }));
        if (path === '/profiles') return Promise.resolve(envelope([salon]));
        return Promise.resolve(envelope(null));
      }),
    );
    saveCookieConsent({ preferences: true, analytics: false });
    window.localStorage.setItem('fluxradar.language', language);
    window.history.replaceState(null, '', '/profiles');
    render(<App />);

    expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: old })).not.toBeInTheDocument();
  });
});

describe('the sites list', () => {
  it.each([
    ['en', 'My sites', 'Registered public origins', 'Check this site', 'New scan'],
    ['uk', 'Мої сайти', 'Зареєстровані публічні джерела', 'Перевірити сайт', 'Нова перевірка'],
  ] as const)(
    'is titled plainly and names what the site button does in %s',
    (language, title, oldLabel, check, oldCheck) => {
      renderDesktop(language, [salon]);

      expect(screen.getByText(title, TITLEBAR)).toBeInTheDocument();
      expect(screen.queryByText(oldLabel)).not.toBeInTheDocument();
      expect(within(rowOf('Salon')).getByRole('button', { name: check })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: oldCheck })).not.toBeInTheDocument();
    },
  );

  it.each([
    ['en', '+ Add another site', '+ Add a site'],
    ['uk', '+ Додати ще один сайт', '+ Додати сайт'],
  ] as const)(
    'offers to add another site, quieter than the site’s own check, in %s',
    (language, another, first) => {
      renderDesktop(language, [salon, studio]);

      const add = screen.getByRole('button', { name: another });
      expect(screen.queryByRole('button', { name: first })).not.toBeInTheDocument();
      const check = within(rowOf('Salon')).getAllByRole('button')[0] as HTMLElement;
      expect(check).toHaveClass('button--primary');
      expect(add).not.toHaveClass('button--primary');
    },
  );

  it.each([
    ['en', '+ Add a site'],
    ['uk', '+ Додати сайт'],
  ] as const)('asks for the first site, as the main action, in %s', (language, label) => {
    render(<AddSiteToggle language={language} siteCount={0} onOpen={() => {}} />);

    expect(screen.getByRole('button', { name: label })).toHaveClass('button--primary');
  });
});

describe('the add-a-site form', () => {
  it.each([
    [
      'en',
      'Add a site',
      'Add your site’s address. We read only public pages, with no passwords and no access to your site. Saving starts nothing and charges nothing.',
      'Enter the address of your homepage, for example mysalon.com.',
      'Save site',
    ],
    [
      'uk',
      'Додати сайт',
      'Додайте адресу сайту. Ми читаємо лише публічні сторінки, без паролів і доступу до сайту. Збереження нічого не запускає і не списує гроші.',
      'Введіть адресу головної сторінки, наприклад mysalon.com.ua.',
      'Зберегти сайт',
    ],
  ] as const)(
    'says in one line what adding a site does in %s',
    (language, title, help, addressHint, save) => {
      renderDesktop(language, []);

      expect(screen.getByText(title, PANEL_LABEL)).toBeInTheDocument();
      expect(screen.getByText(help)).toBeInTheDocument();
      expect(screen.getByText(addressHint)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: save })).toBeInTheDocument();
      expect(screen.queryByText(/профіл|profile/i)).not.toBeInTheDocument();
    },
  );

  it.each([
    [
      'en',
      'What your business does (optional)',
      'Fill in the type of business, services and city, for example “nail salon”, “gel polish and pedicure”, “Zhytomyr”. It helps us check more accurately whether ChatGPT and other AI assistants know about you.',
    ],
    [
      'uk',
      'Чим займається ваш бізнес (необов’язково)',
      'Вкажіть тип бізнесу, послуги й місто, наприклад «салон манікюру», «гель-лак і педикюр», «Житомир». Так ми точніше перевіримо, чи знають про вас ChatGPT та інші ШІ-помічники.',
    ],
  ] as const)(
    'asks what the business does, with an example, before it is unfolded in %s',
    (language, label, hint) => {
      renderDesktop(language, []);

      const summary = screen.getByText(label).closest('summary');
      if (summary === null) throw new Error('expected the context section summary');
      expect(summary).toHaveTextContent(hint);
      expect(summary.closest('details')).not.toHaveAttribute('open');
      // Named by the label alone, with the example as its description.
      expect(summary).toHaveAccessibleName(label);
      expect(summary).toHaveAccessibleDescription(hint);
    },
  );

  it.each([
    ['en', 'Actions for Salon', 'Edit site', 'Save changes'],
    ['uk', 'Дії для Salon', 'Змінити сайт', 'Зберегти зміни'],
  ] as const)('calls editing a saved site by its name in %s', (language, menu, edit, save) => {
    renderDesktop(language, [salon]);

    fireEvent.click(screen.getByRole('button', { name: menu }));
    fireEvent.click(screen.getByRole('menuitem', { name: edit }));

    expect(screen.getByText(edit, PANEL_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: save })).toBeInTheDocument();
  });

  it.each([
    ['en', '+ Add another site', 'Cancel', 'Cancel editing', 'Actions for Salon', 'Edit site'],
    [
      'uk',
      '+ Додати ще один сайт',
      'Скасувати',
      'Скасувати редагування',
      'Дії для Salon',
      'Змінити сайт',
    ],
  ] as const)(
    'offers a plain Cancel when adding and Cancel editing when editing in %s',
    (language, add, cancelAdd, cancelEdit, menu, edit) => {
      renderDesktop(language, [salon]);

      fireEvent.click(screen.getByRole('button', { name: add }));
      expect(screen.getByRole('button', { name: cancelAdd })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: cancelEdit })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: cancelAdd }));

      fireEvent.click(screen.getByRole('button', { name: menu }));
      fireEvent.click(screen.getByRole('menuitem', { name: edit }));
      expect(screen.getByRole('button', { name: cancelEdit })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: cancelAdd })).not.toBeInTheDocument();
    },
  );
});

describe('optional extras', () => {
  it.each([
    ['en', 'Optional: confirm the site is yours'],
    ['uk', 'Необов’язково: підтвердити, що сайт ваш'],
  ] as const)('opens the ownership proof with the word optional in %s', async (language, line) => {
    renderDesktop(language, [salon]);

    const summary = await screen.findByText(line);
    // Plain weight: a bold line read as one more step the owner had left undone.
    expect(summary.tagName).not.toBe('STRONG');
    expect(summary.closest('summary')).not.toBeNull();
  });
});
