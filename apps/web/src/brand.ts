import type { Language } from './i18n';

// The outward-facing identity of the product: the mailbox a customer can write
// to and the studio behind FluxRadar. Copy modules and document bodies read
// these instead of repeating the literals, so moving the support address is one
// edit rather than a grep across every public page.

/** The published support address. Shown on every public contact surface. */
export const SUPPORT_EMAIL = 'support@fluxradar.net';

/** The studio site the footer attribution links to. */
export const FLUXLAB_URL = 'https://flux-lab.dev';

/**
 * Footer attribution, translated like the rest of the shell copy.
 *
 * It credits the studio that *built* FluxRadar. "Powered by" read, in Ukrainian
 * especially, as though the product ran on top of FluxLab — a platform the
 * service depends on — which is not what the line is for. Both locales now say
 * the same thing: FluxLab made this.
 *
 * The `.powered-by` class and the blog's `blog.poweredBy` translation key keep
 * their names: they are the structural contract this footer shares with the
 * static blog pages, and renaming them across those files would buy nothing a
 * reader can see.
 */
export const createdByFluxLab: Record<Language, string> = {
  en: 'Created by FluxLab',
  uk: 'Створено FluxLab',
};
