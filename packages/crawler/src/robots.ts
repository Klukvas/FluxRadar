// Парсер robots.txt без внешних зависимостей (T-07).
// Модель по Google robots spec (RFC 9309): группы User-agent,
// Allow/Disallow с longest-match, wildcard `*` и якорь `$`, Sitemap-директивы.

export interface RobotsRule {
  readonly type: 'allow' | 'disallow';
  /** Path-шаблон как в файле: `*` — любая последовательность, `$` в конце — якорь. */
  readonly pattern: string;
}

export interface RobotsGroup {
  /** Токены User-agent группы, lowercase. */
  readonly userAgents: readonly string[];
  readonly rules: readonly RobotsRule[];
}

export interface RobotsTxt {
  readonly groups: readonly RobotsGroup[];
  /** Абсолютные URL из Sitemap-директив (вне групп по спецификации). */
  readonly sitemaps: readonly string[];
}

const WILDCARD_UA = '*';

/** Лояльный парсер: неизвестные директивы и мусорные строки игнорируются. */
export function parseRobotsTxt(content: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let currentAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let collectingAgents = false;

  const flushGroup = (): void => {
    if (currentAgents.length > 0) {
      groups.push({ userAgents: currentAgents, rules: currentRules });
    }
    currentAgents = [];
    currentRules = [];
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === '') {
      continue;
    }
    const directive = parseDirective(line);
    if (directive === null) {
      continue;
    }
    const { name, value } = directive;
    if (name === 'user-agent') {
      if (!collectingAgents) {
        flushGroup();
        collectingAgents = true;
      }
      if (value !== '') {
        currentAgents.push(value.toLowerCase());
      }
      continue;
    }
    if (name === 'sitemap') {
      if (value !== '') {
        sitemaps.push(value);
      }
      continue;
    }
    if (name === 'allow' || name === 'disallow') {
      collectingAgents = false;
      // Пустой Disallow означает «всё разрешено» — правило не создаётся.
      if (value !== '') {
        currentRules.push({ type: name, pattern: value });
      }
      continue;
    }
    // Прочие директивы (Crawl-delay и т.п.) закрывают набор User-agent строк.
    collectingAgents = false;
  }
  flushGroup();
  return { groups, sitemaps };
}

/**
 * Проверка пути по правилам группы, подобранной для userAgent.
 * Longest-match: побеждает правило с самым длинным шаблоном; при равной
 * длине Allow сильнее Disallow. Нет совпадений — разрешено.
 */
export function isPathAllowed(robots: RobotsTxt, userAgent: string, path: string): boolean {
  const rules = selectRules(robots, userAgent);
  let best: { rule: RobotsRule; length: number } | null = null;
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, path)) {
      continue;
    }
    const length = rule.pattern.length;
    if (
      best === null ||
      length > best.length ||
      (length === best.length && rule.type === 'allow' && best.rule.type === 'disallow')
    ) {
      best = { rule, length };
    }
  }
  return best === null || best.rule.type === 'allow';
}

/**
 * Выбор группы: самый длинный токен User-agent, входящий подстрокой в имя
 * агента (case-insensitive); `*` — только если специфичных совпадений нет.
 * Группы с одинаковым выигравшим токеном объединяются (RFC 9309 §2.2.1).
 */
function selectRules(robots: RobotsTxt, userAgent: string): readonly RobotsRule[] {
  const agentLower = userAgent.toLowerCase();
  let bestToken: string | null = null;
  for (const group of robots.groups) {
    for (const token of group.userAgents) {
      if (token === WILDCARD_UA || !agentLower.includes(token)) {
        continue;
      }
      if (bestToken === null || token.length > bestToken.length) {
        bestToken = token;
      }
    }
  }
  const wantedToken = bestToken ?? WILDCARD_UA;
  return robots.groups
    .filter((group) => group.userAgents.includes(wantedToken))
    .flatMap((group) => group.rules);
}

/** `*` — любая последовательность (включая пустую), `$` в конце — конец пути. */
export function matchesPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regexBody = body.split('*').map(escapeRegExp).join('[^]*');
  const regex = new RegExp(`^${regexBody}${anchored ? '$' : ''}`);
  return regex.test(path);
}

function stripComment(line: string): string {
  const hashIndex = line.indexOf('#');
  return hashIndex === -1 ? line : line.slice(0, hashIndex);
}

function parseDirective(line: string): { readonly name: string; readonly value: string } | null {
  const separatorIndex = line.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }
  return {
    name: line.slice(0, separatorIndex).trim().toLowerCase(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
