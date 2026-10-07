import { renderEmailLayout } from './email-layout.ts';
import type { RenderedEmail } from './verification-email.ts';

/** `link` already carries the `reset_token` query parameter. */
export function renderPasswordResetEmail(link: string): RenderedEmail {
  return {
    subject: 'Reset your FluxRadar password',
    html: renderEmailLayout({
      title: 'Reset your FluxRadar password',
      preheader: 'Reset your FluxRadar password. This link expires in 1 hour.',
      heading: 'Reset your password',
      introText:
        'We received a request to reset the password for your FluxRadar account. Choose a new password using the link below.',
      ctaLabel: 'Reset password',
      ctaUrl: link,
      expiryNote: 'This link expires in one hour.',
      ignoreNote:
        "Didn't request a password reset? You can safely ignore this email — your password won't change.",
    }),
    text: `Reset your FluxRadar password: ${link}\nThe link expires in one hour.`,
  };
}
