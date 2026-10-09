// The profile form's competitors field (T7): renders, validates live and
// pre-fills across an edit, in both languages.
//
// Queried by placeholder rather than `getByLabelText`: this form's `Field`
// puts a hint span inside the same `<label>` as the input, so the label's
// accessible name is "label text + hint text" — an exact `getByLabelText`
// match on the label alone never succeeds for any field here.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesktopScreen } from './DesktopScreen';
import type { SiteProfile } from './api';

const NOOP_ASYNC = () => Promise.resolve();

function renderForm(language: 'en' | 'uk' = 'en', profiles: readonly SiteProfile[] = []) {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the profile form competitors field (T7)', () => {
  it('renders the field with its hint, EN', () => {
    renderForm('en');
    expect(screen.getByText('Competitors')).toBeInTheDocument();
    expect(screen.getByText(/never sent to an AI provider/)).toBeInTheDocument();
  });

  it('renders the field with its hint, UK', () => {
    renderForm('uk');
    expect(screen.getByText('Конкуренти')).toBeInTheDocument();
    expect(screen.getByText(/ніколи не надсилаються AI-провайдеру/)).toBeInTheDocument();
  });

  it('flags more than 5 competitors and disables save', () => {
    renderForm('en');
    fireEvent.change(screen.getByPlaceholderText('Product site'), {
      target: { value: 'Smile Clinic' },
    });
    fireEvent.change(screen.getByPlaceholderText('Acme Dental, Bright Smile Clinic'), {
      target: { value: 'A1, B1, C1, D1, E1, F1' },
    });
    expect(screen.getByText('List up to 5 competitors.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('flags a competitor equal to the site’s own name', () => {
    renderForm('en');
    fireEvent.change(screen.getByPlaceholderText('Product site'), {
      target: { value: 'Smile Clinic' },
    });
    fireEvent.change(screen.getByPlaceholderText('Acme Dental, Bright Smile Clinic'), {
      target: { value: 'Smile Clinic' },
    });
    expect(
      screen.getByText(
        'A competitor cannot repeat this site’s own name or domain: "Smile Clinic".',
      ),
    ).toBeInTheDocument();
  });

  // No address: a complete one starts the read that holds the form, and what
  // this test is about is the list and the save button, not the read.
  it('accepts a valid list and re-enables save', () => {
    renderForm('en');
    fireEvent.change(screen.getByPlaceholderText('Product site'), {
      target: { value: 'Smile Clinic' },
    });
    fireEvent.change(screen.getByPlaceholderText('Acme Dental, Bright Smile Clinic'), {
      target: { value: 'Acme Dental, Bright Smile' },
    });
    expect(screen.queryByText('List up to 5 competitors.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save profile' })).not.toBeDisabled();
  });

  it('pre-fills the field from a saved profile when editing', () => {
    const profile: SiteProfile = {
      id: 'profile-1',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      competitors: ['Acme Dental', 'Bright Smile'],
    };
    renderForm('en', [profile]);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Smile Clinic' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit profile' }));
    expect(screen.getByPlaceholderText('Acme Dental, Bright Smile Clinic')).toHaveValue(
      'Acme Dental, Bright Smile',
    );
  });
});
