/** Fixed public link labels only. Never forward arbitrary campaign strings or persist them. */
export const APPROVED_CAMPAIGN_PAIRS = {
  instagram: 'social',
  google: 'organic',
  bing: 'organic',
  chatgpt: 'referral',
  perplexity: 'referral',
  claude: 'referral',
  newsletter: 'email',
} as const;

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
  if (source === undefined || !Object.hasOwn(APPROVED_CAMPAIGN_PAIRS, source)) return null;
  const medium = APPROVED_CAMPAIGN_PAIRS[source as keyof typeof APPROVED_CAMPAIGN_PAIRS];
  return media[0] === medium ? { campaign_source: source, campaign_medium: medium } : null;
}
