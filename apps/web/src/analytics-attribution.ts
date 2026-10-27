/** Fixed public link labels only. Never forward arbitrary campaign strings or persist them. */
export const APPROVED_CAMPAIGN_PAIRS = {
  instagram: ['social'],
  // Organic is the link in a profile or an answer; cpc is the Search campaign.
  google: ['organic', 'cpc'],
  bing: ['organic'],
  chatgpt: ['referral'],
  perplexity: ['referral'],
  claude: ['referral'],
  newsletter: ['email'],
} as const satisfies Record<string, readonly string[]>;

type ApprovedSource = keyof typeof APPROVED_CAMPAIGN_PAIRS;

/** Google Ads click ids are URL-safe tokens; anything else is not one of ours. */
const GOOGLE_CLICK_ID = /^[A-Za-z0-9_-]{1,200}$/;

function approvedMedia(source: string): readonly string[] | null {
  return Object.hasOwn(APPROVED_CAMPAIGN_PAIRS, source)
    ? APPROVED_CAMPAIGN_PAIRS[source as ApprovedSource]
    : null;
}

export function approvedAttribution(
  search: string,
): { readonly campaign_source: string; readonly campaign_medium: string } | null {
  const params = new URLSearchParams(search);
  const sources = params.getAll('utm_source');
  const media = params.getAll('utm_medium');
  if (sources.length !== 1) return null;
  if (sources[0] === 'chatgpt.com') {
    return media.length === 0 || (media.length === 1 && media[0] === 'referral')
      ? { campaign_source: 'chatgpt', campaign_medium: 'referral' }
      : null;
  }
  if (media.length !== 1) return null;
  const source = sources[0];
  const medium = media[0];
  if (source === undefined || medium === undefined) return null;
  const allowed = approvedMedia(source);
  return allowed !== null && allowed.includes(medium)
    ? { campaign_source: source, campaign_medium: medium }
    : null;
}

/**
 * The Google Ads click id, and nothing else a query may hold. GA4 reads it from
 * the landing page_location to tell an ad click from an organic visit; without
 * it the campaign a visit came from, and every sign-up or purchase behind it,
 * is invisible to Ads. One well-formed value or nothing: a second `gclid`, a
 * longer token or any other character is a query we do not recognise.
 */
export function approvedClickId(search: string): string | null {
  const ids = new URLSearchParams(search).getAll('gclid');
  if (ids.length !== 1) return null;
  const id = ids[0];
  return id !== undefined && GOOGLE_CLICK_ID.test(id) ? id : null;
}
