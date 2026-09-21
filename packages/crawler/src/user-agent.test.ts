import { describe, expect, it } from 'vitest';

import { parseRobotsTxt, isPathAllowed } from './robots.js';
import {
  CRAWLER_INFO_URL,
  CRAWLER_PRODUCT_TOKEN,
  CRAWLER_USER_AGENT,
  crawlerUserAgent,
} from './user-agent.js';

describe('the crawler user agent', () => {
  it('carries a link to the page that explains it', () => {
    // Without it an owner whose WAF refused us has a string in their logs and
    // nowhere to go with it — which is exactly what happened on 2026-09-21.
    expect(CRAWLER_USER_AGENT).toBe('FluxRadarBot/0.1 (+https://fluxradar.net/bot)');
    expect(CRAWLER_USER_AGENT).toContain(CRAWLER_INFO_URL);
  });

  it('keeps the product token first, so one allowlist entry covers both devices', () => {
    expect(crawlerUserAgent('desktop').startsWith(CRAWLER_PRODUCT_TOKEN)).toBe(true);
    expect(crawlerUserAgent('mobile').startsWith(CRAWLER_PRODUCT_TOKEN)).toBe(true);
    expect(crawlerUserAgent('mobile')).toBe(`${CRAWLER_USER_AGENT} Mobile`);
  });

  it.each(['desktop', 'mobile'] as const)(
    'still matches a robots.txt group written for the bare token (%s)',
    (device) => {
      // The +URL comment is inside the same string robots matching reads, so a
      // site addressing `FluxRadarBot` must keep addressing us.
      const robots = parseRobotsTxt('User-agent: FluxRadarBot\nDisallow: /private\n');

      expect(isPathAllowed(robots, crawlerUserAgent(device), '/private/x')).toBe(false);
      expect(isPathAllowed(robots, crawlerUserAgent(device), '/public')).toBe(true);
    },
  );

  it('does not accidentally match a group written for another crawler', () => {
    const robots = parseRobotsTxt('User-agent: GPTBot\nDisallow: /\n');

    expect(isPathAllowed(robots, CRAWLER_USER_AGENT, '/anything')).toBe(true);
  });
});
