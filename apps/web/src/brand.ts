import type { Language } from './i18n';

// The outward-facing identity of the product: the mailbox a customer can write
// to and the studio behind FluxRadar. Copy modules and document bodies read
// these instead of repeating the literals, so moving the support address is one
// edit rather than a grep across every public page.

/** The published support address. Shown on every public contact surface. */
export const SUPPORT_EMAIL = 'support@flux-lab.dev';

/** The studio site the footer attribution links to. */
export const FLUXLAB_URL = 'https://flux-lab.dev';

/** Footer attribution, translated like the rest of the shell copy. */
export const poweredByFluxLab: Record<Language, string> = {
  en: 'Powered by FluxLab',
  uk: 'Працює на FluxLab',
};
