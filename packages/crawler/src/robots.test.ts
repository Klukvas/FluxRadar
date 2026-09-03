import { describe, expect, it } from 'vitest';

import { isPathAllowed, matchesPattern, parseRobotsTxt } from './robots.js';

describe('parseRobotsTxt', () => {
  it('разбирает группы, правила и Sitemap-директивы', () => {
    const robots = parseRobotsTxt(
      [
        '# комментарий целиком',
        'User-agent: *',
        'Disallow: /private/ # хвостовой комментарий',
        'Allow: /private/public/',
        '',
        'Sitemap: https://site.example/sitemap.xml',
        'User-agent: goodbot',
        'User-agent: otherbot',
        'Disallow: /goodbot-only/',
      ].join('\n'),
    );
    expect(robots.sitemaps).toEqual(['https://site.example/sitemap.xml']);
    expect(robots.groups).toEqual([
      {
        userAgents: ['*'],
        rules: [
          { type: 'disallow', pattern: '/private/' },
          { type: 'allow', pattern: '/private/public/' },
        ],
      },
      {
        userAgents: ['goodbot', 'otherbot'],
        rules: [{ type: 'disallow', pattern: '/goodbot-only/' }],
      },
    ]);
  });

  it('директивы case-insensitive, мусорные строки игнорируются', () => {
    const robots = parseRobotsTxt('USER-AGENT: *\nDISALLOW: /x/\nне директива\nnoise');
    expect(robots.groups).toEqual([
      { userAgents: ['*'], rules: [{ type: 'disallow', pattern: '/x/' }] },
    ]);
  });

  it('пустой Disallow не создаёт правила (означает «всё разрешено»)', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow:');
    expect(robots.groups).toEqual([{ userAgents: ['*'], rules: [] }]);
    expect(isPathAllowed(robots, 'anybot', '/anything')).toBe(true);
  });
});

describe('matchesPattern', () => {
  it('* матчит любую последовательность, включая пустую', () => {
    expect(matchesPattern('/fish*.php', '/fish.php')).toBe(true);
    expect(matchesPattern('/fish*.php', '/fishheads/catfish.php?id=1')).toBe(true);
    expect(matchesPattern('/*.php', '/index.html')).toBe(false);
  });

  it('$ якорит конец пути', () => {
    expect(matchesPattern('/*.pdf$', '/docs/report.pdf')).toBe(true);
    expect(matchesPattern('/*.pdf$', '/docs/report.pdf?page=2')).toBe(false);
    expect(matchesPattern('/exact$', '/exact')).toBe(true);
    expect(matchesPattern('/exact$', '/exactly')).toBe(false);
  });

  it('спецсимволы regex в шаблоне экранируются', () => {
    expect(matchesPattern('/a+b(c)', '/a+b(c)/tail')).toBe(true);
    expect(matchesPattern('/a+b(c)', '/aab')).toBe(false);
  });
});

describe('isPathAllowed', () => {
  const robots = parseRobotsTxt(
    ['User-agent: *', 'Disallow: /folder/', 'Allow: /folder/public/'].join('\n'),
  );

  it('longest match побеждает: более длинный Allow открывает подпуть', () => {
    expect(isPathAllowed(robots, 'anybot', '/folder/page.html')).toBe(false);
    expect(isPathAllowed(robots, 'anybot', '/folder/public/page.html')).toBe(true);
  });

  it('при равной длине шаблонов Allow сильнее Disallow', () => {
    const tied = parseRobotsTxt('User-agent: *\nDisallow: /page\nAllow: /page');
    expect(isPathAllowed(tied, 'anybot', '/page')).toBe(true);
  });

  it('без совпадений путь разрешён', () => {
    expect(isPathAllowed(robots, 'anybot', '/other/')).toBe(true);
  });

  it('специфичная User-agent группа выбирается вместо * и не объединяется с ней', () => {
    const grouped = parseRobotsTxt(
      [
        'User-agent: *',
        'Disallow: /all/',
        'User-agent: fluxradarbot',
        'Disallow: /bot-only/',
      ].join('\n'),
    );
    expect(isPathAllowed(grouped, 'FluxRadarBot/0.1', '/bot-only/x')).toBe(false);
    expect(isPathAllowed(grouped, 'FluxRadarBot/0.1', '/all/x')).toBe(true);
    expect(isPathAllowed(grouped, 'strangerbot', '/all/x')).toBe(false);
  });

  it('wildcard-правила работают через сравнение путей с query', () => {
    const wildcard = parseRobotsTxt('User-agent: *\nDisallow: /*?session=');
    expect(isPathAllowed(wildcard, 'anybot', '/page?session=1')).toBe(false);
    expect(isPathAllowed(wildcard, 'anybot', '/page')).toBe(true);
  });
});
