// SSRF IP guard (план §6, PLAN_REVIEW Security-находки 1 и 3, D-128).
// Без внешних зависимостей: node:net валидирует синтаксис, разбор — вручную.
// Fail-closed: всё, что не распарсилось или не классифицировалось, — непубличное.

import { isIPv4, isIPv6 } from 'node:net';

export type BlockedIpCategory =
  | 'invalid'
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'cgnat'
  | 'broadcast'
  | 'multicast'
  | 'reserved'
  | 'unique-local'
  | 'ipv4-compatible'
  | 'documentation'
  | 'nat64'
  | 'six-to-four';

export type IpClassification =
  | { readonly isPublic: true }
  | { readonly isPublic: false; readonly category: BlockedIpCategory; readonly reason: string };

const PUBLIC: IpClassification = { isPublic: true };

function blocked(category: BlockedIpCategory, reason: string): IpClassification {
  return { isPublic: false, category, reason };
}

interface Ipv4BlockedRange {
  readonly base: number;
  readonly maskBits: number;
  readonly category: BlockedIpCategory;
  readonly reason: string;
}

const IPV4_BLOCKED_RANGES: readonly Ipv4BlockedRange[] = [
  {
    base: ipv4('255.255.255.255'),
    maskBits: 32,
    category: 'broadcast',
    reason: 'broadcast 255.255.255.255',
  },
  { base: ipv4('0.0.0.0'), maskBits: 8, category: 'unspecified', reason: 'this-network 0.0.0.0/8' },
  {
    base: ipv4('127.0.0.1') & maskOf(8),
    maskBits: 8,
    category: 'loopback',
    reason: 'loopback 127.0.0.0/8',
  },
  {
    base: ipv4('10.0.0.0'),
    maskBits: 8,
    category: 'private',
    reason: 'private RFC1918 10.0.0.0/8',
  },
  {
    base: ipv4('172.16.0.0'),
    maskBits: 12,
    category: 'private',
    reason: 'private RFC1918 172.16.0.0/12',
  },
  {
    base: ipv4('192.168.0.0'),
    maskBits: 16,
    category: 'private',
    reason: 'private RFC1918 192.168.0.0/16',
  },
  {
    base: ipv4('169.254.0.0'),
    maskBits: 16,
    category: 'link-local',
    reason: 'link-local 169.254.0.0/16 (incl. cloud metadata 169.254.169.254)',
  },
  {
    base: ipv4('100.64.0.0'),
    maskBits: 10,
    category: 'cgnat',
    reason: 'carrier-grade NAT 100.64.0.0/10',
  },
  { base: ipv4('224.0.0.0'), maskBits: 4, category: 'multicast', reason: 'multicast 224.0.0.0/4' },
  { base: ipv4('240.0.0.0'), maskBits: 4, category: 'reserved', reason: 'reserved 240.0.0.0/4' },
];

/**
 * Классифицирует IP-адрес (IPv4 или IPv6, допускаются скобки `[::1]`).
 * Непубличные категории блокируются SSRF-гардом; вложенный IPv4 внутри
 * IPv4-mapped (::ffff:0:0/96) и NAT64 (64:ff9b::/96) классифицируется рекурсивно.
 */
export function classifyIp(ip: string): IpClassification {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  if (isIPv4(bare)) {
    return classifyIpv4(bare);
  }
  if (isIPv6(bare)) {
    return classifyIpv6(bare);
  }
  return blocked('invalid', `not a valid IP address: "${bare}"`);
}

/** Короткая форма: true только для однозначно публичного адреса. */
export function isPublicIp(ip: string): boolean {
  return classifyIp(ip).isPublic;
}

function classifyIpv4(ip: string): IpClassification {
  const value = ipv4(ip);
  for (const range of IPV4_BLOCKED_RANGES) {
    if ((value & maskOf(range.maskBits)) === (range.base & maskOf(range.maskBits))) {
      return blocked(range.category, range.reason);
    }
  }
  return PUBLIC;
}

/** Числовое значение IPv4 (unsigned 32 bit); вход должен пройти isIPv4. */
function ipv4(ip: string): number {
  const octets = ip.split('.').map(Number);
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function maskOf(maskBits: number): number {
  return maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
}

function classifyIpv6(ip: string): IpClassification {
  const words = parseIpv6Words(ip);
  if (words === null) {
    return blocked('invalid', `unparseable IPv6 address: "${ip}"`);
  }
  const [w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0] = words;
  const leadingZero = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0;

  if (leadingZero && w5 === 0 && w6 === 0 && w7 === 0) {
    return blocked('unspecified', 'IPv6 unspecified ::');
  }
  if (leadingZero && w5 === 0 && w6 === 0 && w7 === 1) {
    return blocked('loopback', 'IPv6 loopback ::1');
  }
  if (leadingZero && w5 === 0xffff) {
    return classifyEmbeddedIpv4(w6, w7, 'IPv4-mapped ::ffff:0:0/96');
  }
  if (leadingZero && w5 === 0) {
    // Deprecated IPv4-compatible ::/96 — блокируется целиком (D-128).
    return blocked('ipv4-compatible', 'deprecated IPv4-compatible ::/96');
  }
  if ((w0 & 0xfe00) === 0xfc00) {
    return blocked('unique-local', 'IPv6 unique local fc00::/7');
  }
  if ((w0 & 0xffc0) === 0xfe80) {
    return blocked('link-local', 'IPv6 link-local fe80::/10');
  }
  if ((w0 & 0xff00) === 0xff00) {
    return blocked('multicast', 'IPv6 multicast ff00::/8');
  }
  if (w0 === 0x2001 && w1 === 0x0db8) {
    return blocked('documentation', 'IPv6 documentation 2001:db8::/32');
  }
  if (w0 === 0x0064 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
    return classifyEmbeddedIpv4(w6, w7, 'NAT64 64:ff9b::/96');
  }
  // RFC 8215 local-use NAT64 (64:ff9b:1::/96): same embedding semantics as 64:ff9b::/96;
  // блокируется по тому же принципу — вложенный IPv4 определяет публичность.
  if (w0 === 0x0064 && w1 === 0xff9b && w2 === 0x0001 && w3 === 0 && w4 === 0 && w5 === 0) {
    return classifyEmbeddedIpv4(w6, w7, 'NAT64 local-use 64:ff9b:1::/96 (RFC 8215)');
  }
  // 6to4 (2002::/16, RFC 3056): формат 2002:AA:BB:CC:DD:…/128, где AA=IPv4[0],
  // BB=IPv4[1], CC=IPv4[2], DD=IPv4[3], т.е. w1=(AA<<8|BB), w2=(CC<<8|DD).
  // Публичный вложенный → публичный (префикс безопасен); приватный/loopback → блок.
  if (w0 === 0x2002) {
    return classifyEmbeddedIpv4(w1, w2, '6to4 2002::/16 (RFC 3056)');
  }
  return PUBLIC;
}

/** Вложенный IPv4 наследует классификацию: публичный → публичный, иначе блок. */
function classifyEmbeddedIpv4(w6: number, w7: number, container: string): IpClassification {
  const embedded = `${w6 >>> 8}.${w6 & 0xff}.${w7 >>> 8}.${w7 & 0xff}`;
  const verdict = classifyIpv4(embedded);
  if (verdict.isPublic) {
    return PUBLIC;
  }
  return blocked(verdict.category, `${container} embedding ${embedded}: ${verdict.reason}`);
}

/**
 * Разбор IPv6 в 8 слов по 16 бит; вход должен пройти isIPv6 (dotted-quad хвост,
 * одиночный `::`). Любое отклонение → null (fail-closed выше по стеку).
 */
function parseIpv6Words(ip: string): readonly number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) {
    return null;
  }
  const left = parseIpv6Side(halves[0] ?? '');
  const right = halves.length === 2 ? parseIpv6Side(halves[1] ?? '') : [];
  if (left === null || right === null) {
    return null;
  }
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const fillLength = 8 - left.length - right.length;
  if (fillLength < 1) {
    return null;
  }
  return [...left, ...Array.from({ length: fillLength }, () => 0), ...right];
}

function parseIpv6Side(side: string): readonly number[] | null {
  if (side === '') {
    return [];
  }
  const parts = side.split(':');
  const words: number[] = [];
  for (const part of parts) {
    if (part.includes('.')) {
      if (!isIPv4(part)) {
        return null;
      }
      const [a = 0, b = 0, c = 0, d = 0] = part.split('.').map(Number);
      words.push((a << 8) | b, (c << 8) | d);
    } else {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
        return null;
      }
      words.push(Number.parseInt(part, 16));
    }
  }
  return words;
}
