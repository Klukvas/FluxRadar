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
      /Basic includes AI SEO \/ GEO.*Complete includes AI SEO \/ GEO and UX\/Conversion/is,
    );
    expect(policy).toHaveTextContent(/production adapter uses Anthropic/i);
    expect(policy).toHaveTextContent(/OpenAI.*not used by the current production adapter/is);
    expect(policy).toHaveTextContent(/Query Ideas is a separate user action/i);
    expect(policy).toHaveTextContent(
      /up to 20 Search Console queries.*clicks, impressions and average position/is,
    );
    expect(policy).toHaveTextContent(/Google OAuth tokens are never sent to an AI provider/i);
    expect(policy).toHaveTextContent(/PageSpeed Insights and CrUX.*public URL or origin/is);
    expect(policy).toHaveTextContent(
      /Free and Basic reports.*30 days.*Complete reports.*365 days/is,
    );
    expect(policy).toHaveTextContent(/account-deletion request.*within 30 days/is);
    expect(policy).toHaveTextContent(/does not currently load Google Analytics 4/i);
    expect(
      screen.getByRole('link', { name: /Google API Services User Data Policy/i }),
    ).toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');
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
    expect(policy).toHaveTextContent(/does not currently load Google Analytics 4/i);
    expect(policy).toHaveTextContent(/FastSpring is the separate merchant of record/i);
    expect(screen.getByRole('navigation', { name: 'Document sections' })).toHaveTextContent(
      'Storage inventory',
    );
  });
});
