import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LegalDocumentScreen } from './LegalDocuments';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('public legal documents', () => {
  it('publishes the identified Ukrainian operator and makes Ukrainian controlling', () => {
    render(<LegalDocumentScreen kind="terms" language="uk" onLanguageChange={() => {}} />);

    const terms = screen.getByRole('article');
    expect(terms).toHaveAttribute('lang', 'uk');
    expect(terms).toHaveTextContent(/ФОП Павленко Андрій Володимирович/);
    expect(terms).toHaveTextContent(/РНОКПП: 3650600237/);
    expect(terms).toHaveTextContent(/2010350000000049793/);
    expect(terms).toHaveTextContent(/Не зареєстрований платником ПДВ/);
    expect(terms).toHaveTextContent(/Володимира Великого, буд\. 8, кв\. 64/);
    expect(terms).toHaveTextContent(/\+380 93 360 20 73/);
    expect(screen.getByText(/юридично пріоритетна українська версія/i)).toBeInTheDocument();
  });

  it('marks English as informational and carries the same operator identity', () => {
    render(<LegalDocumentScreen kind="privacy" language="en" onLanguageChange={() => {}} />);

    const policy = screen.getByRole('article');
    expect(policy).toHaveAttribute('lang', 'en');
    expect(policy).toHaveTextContent(/Pavlenko Andrii Volodymyrovich/);
    expect(policy).toHaveTextContent(/Ukrainian individual entrepreneur trading as FluxLab/);
    expect(policy).toHaveTextContent(/Ukrainian taxpayer number: 3650600237/);
    expect(screen.getByText(/informational translation/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'support@fluxradar.net' }).length).toBeGreaterThan(
      0,
    );
  });

  it('states the purchase, public-site and report rules without removing mandatory remedies', () => {
    render(<LegalDocumentScreen kind="terms" language="en" onLanguageChange={() => {}} />);

    const terms = screen.getByRole('article');
    expect(terms).toHaveTextContent(/any publicly accessible site/i);
    expect(terms).toHaveTextContent(/disable compliance with robots\.txt.*lawful authority/is);
    expect(terms).toHaveTextContent(/one-time audits.*no subscription or automatic renewal/is);
    expect(terms).toHaveTextContent(/within 24 hours/i);
    expect(terms).toHaveTextContent(/non-delivery.*verified material technical defect/is);
    expect(terms).toHaveTextContent(/mandatory consumer.*withdrawal.*refund/is);
    expect(terms).toHaveTextContent(/private and account-scoped.*download, share and publish/is);
    expect(terms).toHaveTextContent(/limited to the amount paid for the specific affected audit/i);
    expect(terms).toHaveTextContent(/Ukrainian law/i);
    expect(terms).not.toHaveTextContent(/all sales are final|no refunds/i);
  });

  it('accurately discloses AI, Google, providers and retention', () => {
    render(<LegalDocumentScreen kind="privacy" language="en" onLanguageChange={() => {}} />);

    const policy = screen.getByRole('article');
    expect(policy).toHaveTextContent(
      /Basic includes AI SEO \/ GEO, Website Audit includes UX\/Conversion only, and Complete includes AI SEO \/ GEO and UX\/Conversion/is,
    );
    // Website Audit runs the UX review but no GEO: the policy must not let a
    // reader infer a discovery or brand-awareness transfer it never makes.
    expect(policy).toHaveTextContent(
      /Website Audit does not run AI SEO \/ GEO, so no discovery or brand-awareness question is sent/is,
    );
    expect(policy).toHaveTextContent(
      /visibility questions go to Anthropic and OpenAI, both answering with their own web search/is,
    );
    expect(policy).toHaveTextContent(
      /OpenAI is an active AI provider for the visibility questions/i,
    );
    // Naming the opt-in recipients is what makes the choice on the new-scan
    // screen honest; a policy that omitted them would be the dishonest half.
    expect(policy).toHaveTextContent(
      /Google \(Gemini\) and Perplexity are opt-in recipients.*receive nothing unless you select them/is,
    );
    expect(policy).toHaveTextContent(
      /AI Action Plan \(Website Audit and Complete\) sends Anthropic the report’s rule metadata only/i,
    );
    expect(policy).toHaveTextContent(
      /never sends evidence excerpts, screenshots, or anything from the Analytics section/i,
    );
    // The Query Ideas generator that sent Search Console queries to the AI
    // provider was removed; a policy still describing it would disclose a
    // transfer of Google user data the product no longer makes.
    expect(policy).not.toHaveTextContent(/Query Ideas/i);
    expect(policy).toHaveTextContent(
      /Search Console and Analytics data.*not sent to an AI provider/is,
    );
    expect(policy).toHaveTextContent(/Google OAuth tokens are never sent to an AI provider/i);
    expect(policy).toHaveTextContent(/Disconnecting Google deletes the stored tokens/i);
    expect(policy).toHaveTextContent(/Effective 23 September 2026/);
    expect(policy).toHaveTextContent(/PageSpeed Insights and CrUX.*public URL or origin/is);
    expect(policy).toHaveTextContent(
      /Free and Basic reports.*30 days.*Website Audit and Complete reports.*365 days/is,
    );
    expect(policy).toHaveTextContent(/account-deletion request.*within 30 days/is);
    // Site analytics is disclosed as consent-based, with the settings the
    // property actually has (Signals, ads and remarketing off, 2-month retention).
    expect(policy).toHaveTextContent(/Site analytics, only if you allow it/i);
    expect(policy).toHaveTextContent(/without query strings or check identifiers/i);
    expect(policy).toHaveTextContent(/Google \(Google Analytics 4\).*as our processor/is);
    expect(policy).toHaveTextContent(/does not start before you allow it/i);
    expect(policy).toHaveTextContent(
      /Google Signals, ads personalization and remarketing are disabled.*2 months/is,
    );
    expect(policy).toHaveTextContent(/uses no advertising trackers/i);
    expect(policy).not.toHaveTextContent(/does not currently load Google Analytics 4/i);
    expect(
      screen.getByRole('link', { name: /Google API Services User Data Policy/i }),
    ).toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');
  });

  // Google's OAuth verification rejects a policy that does not say how Google
  // user data is secured, so each protection it relies on stays pinned here.
  it('states how Google user data is protected, in both languages', () => {
    render(<LegalDocumentScreen kind="privacy" language="en" onLanguageChange={() => {}} />);

    const policy = screen.getByRole('article');
    expect(screen.getByRole('heading', { name: 'How we protect Google user data' })).toBeVisible();
    expect(policy).toHaveTextContent(/served only over HTTPS with HSTS/i);
    expect(policy).toHaveTextContent(/refresh tokens are encrypted at rest with AES-256-GCM/i);
    expect(policy).toHaveTextContent(/Tokens are never sent to your browser/i);
    expect(policy).toHaveTextContent(/cannot change or delete anything in your Google account/i);
    expect(policy).toHaveTextContent(/does not read data about individual visitors/i);
    expect(policy).toHaveTextContent(/available only to the account that connected Google/i);
    expect(policy).toHaveTextContent(/database backups are encrypted with AES-256-GCM/i);
    expect(screen.getByRole('link', { name: 'Google Account connections' })).toHaveAttribute(
      'href',
      'https://myaccount.google.com/connections',
    );
    expect(screen.getByRole('navigation', { name: 'Document sections' })).toHaveTextContent(
      'Protecting Google data',
    );

    cleanup();
    render(<LegalDocumentScreen kind="privacy" language="uk" onLanguageChange={() => {}} />);

    expect(
      screen.getByRole('heading', { name: 'Як ми захищаємо дані користувача Google' }),
    ).toBeVisible();
    expect(screen.getByRole('article')).toHaveTextContent(/AES‑256‑GCM/);
  });

  it('provides a standalone, accurate cookie and storage inventory', () => {
    render(<LegalDocumentScreen kind="cookies" language="en" onLanguageChange={() => {}} />);

    const policy = screen.getByRole('article');
    expect(policy).toHaveAttribute('lang', 'en');
    expect(policy).toHaveTextContent(/fluxradar_session/);
    expect(policy).toHaveTextContent(/browser session closes.*Remember me.*7 days/is);
    expect(policy).toHaveTextContent(/fluxradar\.pendingCheckout/);
    expect(policy).toHaveTextContent(/fluxradar\.cookieConsent.*180 days/is);
    expect(policy).toHaveTextContent(/fluxradar\.language/);
    expect(policy).toHaveTextContent(/Google Analytics 4 does not load until you allow analytics/i);
    // Both cookies gtag sets, the second named after the stream it reports to.
    expect(policy).toHaveTextContent(
      /_ga.*random identifier.*Up to 180 days from your last visit/is,
    );
    expect(policy).toHaveTextContent(/_ga_0N0B548CGE/);
    expect(policy).toHaveTextContent(
      /Google Signals, ads personalization and remarketing are disabled.*2 months/is,
    );
    expect(policy).toHaveTextContent(/FastSpring is the separate merchant of record/i);
    expect(policy).toHaveTextContent(/Effective 21 September 2026/);
    const sections = screen.getByRole('navigation', { name: 'Document sections' });
    expect(sections).toHaveTextContent('Storage inventory');
    expect(sections).toHaveTextContent('Google Analytics');
    // Once every cookie is allowed the floating launcher is hidden, so the
    // policy page itself has to offer the way to withdraw.
    expect(screen.getByRole('button', { name: 'Cookie settings' })).toBeInTheDocument();
  });

  it('offers the cookie settings control on the Ukrainian cookie policy too', () => {
    render(<LegalDocumentScreen kind="cookies" language="uk" onLanguageChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Налаштування cookies' })).toBeInTheDocument();
  });

  // The Ukrainian text is the controlling one, so the analytics disclosure is
  // pinned there as well as in the translation.
  it('discloses consent-based Google Analytics in the controlling Ukrainian text', () => {
    render(<LegalDocumentScreen kind="cookies" language="uk" onLanguageChange={() => {}} />);
    const cookies = screen.getByRole('article');
    expect(cookies).toHaveTextContent(/Google Analytics 4 не завантажується, доки ви не дозволите/);
    expect(cookies).toHaveTextContent(/_ga_0N0B548CGE/);
    expect(cookies).toHaveTextContent(/user та event data зберігаються 2 місяці/);

    cleanup();
    render(<LegalDocumentScreen kind="privacy" language="uk" onLanguageChange={() => {}} />);
    const privacy = screen.getByRole('article');
    expect(privacy).toHaveTextContent(/Аналітика сайту — лише з вашого дозволу/);
    expect(privacy).toHaveTextContent(/Google \(Google Analytics 4\).*як наш обробник/s);
    expect(privacy).toHaveTextContent(/Чинна з 23 вересня 2026 року/);
  });
});
