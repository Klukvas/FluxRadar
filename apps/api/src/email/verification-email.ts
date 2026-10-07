import { renderEmailLayout } from './email-layout.ts';

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** `link` already carries the `verify_email` token query parameter. */
export function renderVerificationEmail(link: string): RenderedEmail {
  return {
    subject: 'Verify your FluxRadar email',
    html: renderEmailLayout({
      title: 'Verify your FluxRadar email',
      preheader: 'Confirm your email to keep your FluxRadar workspace secure.',
      heading: 'Confirm your email address',
      introText:
        'Welcome to FluxRadar. Verify this address to secure your account and start your first scan.',
      ctaLabel: 'Verify email',
      ctaUrl: link,
      expiryNote: 'This link expires in 24 hours.',
      ignoreNote: "Didn't create a FluxRadar account? You can safely ignore this email.",
    }),
    text: `Confirm your FluxRadar email: ${link}`,
  };
}
