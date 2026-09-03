import { describe, expect, it } from 'vitest';

import type { BlockedIpCategory } from './ip-guard.js';
import { classifyIp, isPublicIp } from './ip-guard.js';

interface GuardCase {
  readonly ip: string;
  readonly isPublic: boolean;
  readonly category?: BlockedIpCategory;
}

const CASES: readonly GuardCase[] = [
  // --- IPv4: публичные ---
  { ip: '8.8.8.8', isPublic: true },
  { ip: '1.1.1.1', isPublic: true },
  { ip: '93.184.216.34', isPublic: true },
  { ip: '100.63.255.255', isPublic: true }, // на 1 ниже CGNAT 100.64/10
  { ip: '100.128.0.0', isPublic: true }, // сразу за CGNAT
  { ip: '172.32.0.1', isPublic: true }, // вне 172.16/12
  { ip: '192.169.0.1', isPublic: true }, // вне 192.168/16
  { ip: '169.253.255.255', isPublic: true }, // на 1 ниже link-local
  { ip: '223.255.255.255', isPublic: true }, // на 1 ниже multicast

  // --- IPv4: блокируемые ---
  { ip: '127.0.0.1', isPublic: false, category: 'loopback' },
  { ip: '127.255.255.254', isPublic: false, category: 'loopback' },
  { ip: '10.0.0.1', isPublic: false, category: 'private' },
  { ip: '172.16.0.1', isPublic: false, category: 'private' },
  { ip: '172.31.255.255', isPublic: false, category: 'private' },
  { ip: '192.168.1.1', isPublic: false, category: 'private' },
  { ip: '169.254.169.254', isPublic: false, category: 'link-local' }, // cloud metadata
  { ip: '169.254.0.1', isPublic: false, category: 'link-local' },
  { ip: '0.0.0.0', isPublic: false, category: 'unspecified' },
  { ip: '0.1.2.3', isPublic: false, category: 'unspecified' },
  { ip: '255.255.255.255', isPublic: false, category: 'broadcast' },
  { ip: '100.64.0.1', isPublic: false, category: 'cgnat' },
  { ip: '100.127.255.255', isPublic: false, category: 'cgnat' },
  { ip: '224.0.0.1', isPublic: false, category: 'multicast' },
  { ip: '239.255.255.255', isPublic: false, category: 'multicast' },
  { ip: '240.0.0.1', isPublic: false, category: 'reserved' },

  // --- IPv6: публичные ---
  { ip: '2606:4700::1111', isPublic: true },
  { ip: '2001:4860:4860::8888', isPublic: true },
  { ip: '2a00:1450:4001:80b::200e', isPublic: true },
  { ip: '64:ff9b::808:808', isPublic: true }, // NAT64 с публичным вложенным 8.8.8.8
  { ip: '::ffff:8.8.8.8', isPublic: true }, // IPv4-mapped с публичным вложенным
  { ip: '64:ff9b:1::808:808', isPublic: true }, // NAT64 local-use с публичным вложенным 8.8.8.8
  { ip: '2002:0808:0808::', isPublic: true }, // 6to4 с публичным вложенным 8.8.8.8

  // --- IPv6: блокируемые ---
  { ip: '::1', isPublic: false, category: 'loopback' },
  { ip: '::', isPublic: false, category: 'unspecified' },
  { ip: 'fc00::1', isPublic: false, category: 'unique-local' },
  { ip: 'fd12:3456::1', isPublic: false, category: 'unique-local' },
  { ip: 'fe80::1', isPublic: false, category: 'link-local' },
  { ip: 'febf::1', isPublic: false, category: 'link-local' }, // верхняя граница fe80::/10
  { ip: 'ff02::1', isPublic: false, category: 'multicast' },
  { ip: '::ffff:10.0.0.1', isPublic: false, category: 'private' },
  { ip: '::ffff:127.0.0.1', isPublic: false, category: 'loopback' },
  { ip: '::ffff:169.254.169.254', isPublic: false, category: 'link-local' },
  { ip: '2001:db8::1', isPublic: false, category: 'documentation' },
  { ip: '64:ff9b::0a00:0001', isPublic: false, category: 'private' }, // NAT64 → 10.0.0.1
  { ip: '::0102:0304', isPublic: false, category: 'ipv4-compatible' },
  // NAT64 local-use (RFC 8215) — был незакрытым вектором SSRF
  { ip: '64:ff9b:1::7f00:1', isPublic: false, category: 'loopback' }, // → 127.0.0.1
  { ip: '64:ff9b:1::a00:1', isPublic: false, category: 'private' }, // → 10.0.0.1
  { ip: '64:ff9b:1::a9fe:a9fe', isPublic: false, category: 'link-local' }, // → 169.254.169.254
  // 6to4 (RFC 3056) — был незакрытым вектором SSRF
  { ip: '2002:7f00:1::', isPublic: false, category: 'loopback' }, // → 127.0.0.1
  { ip: '2002:0a00:1::', isPublic: false, category: 'private' }, // → 10.0.0.1
  { ip: '2002:c0a8:101::', isPublic: false, category: 'private' }, // → 192.168.1.1
  { ip: '2002:a9fe:a9fe::', isPublic: false, category: 'link-local' }, // → 169.254.169.254

  // --- мусор: fail-closed ---
  { ip: 'not-an-ip', isPublic: false, category: 'invalid' },
  { ip: '0177.0.0.1', isPublic: false, category: 'invalid' }, // октальная форма не IP-литерал
  { ip: 'fe80::1%en0', isPublic: false, category: 'invalid' }, // zone id не про DNS-ответ
];

describe('classifyIp', () => {
  for (const guardCase of CASES) {
    const verdictLabel = guardCase.isPublic ? 'public' : `blocked (${guardCase.category})`;
    it(`${guardCase.ip} → ${verdictLabel}`, () => {
      const verdict = classifyIp(guardCase.ip);
      expect(verdict.isPublic).toBe(guardCase.isPublic);
      if (!verdict.isPublic && guardCase.category !== undefined) {
        expect(verdict.category).toBe(guardCase.category);
      }
    });
  }

  it('срезает скобки IPv6-литерала из URL.hostname', () => {
    expect(isPublicIp('[::1]')).toBe(false);
    expect(isPublicIp('[2606:4700::1111]')).toBe(true);
  });

  it('вложенный IPv4 в mapped-адресе попадает в reason', () => {
    const verdict = classifyIp('::ffff:169.254.169.254');
    expect(verdict.isPublic).toBe(false);
    if (!verdict.isPublic) {
      expect(verdict.reason).toContain('169.254.169.254');
      expect(verdict.reason).toContain('IPv4-mapped');
    }
  });

  it('NAT64 local-use 64:ff9b:1:: reason содержит вложенный IPv4', () => {
    const verdict = classifyIp('64:ff9b:1::7f00:1');
    expect(verdict.isPublic).toBe(false);
    if (!verdict.isPublic) {
      expect(verdict.reason).toContain('127.0.0.1');
      expect(verdict.reason).toContain('64:ff9b:1::/96');
    }
  });

  it('6to4 reason содержит вложенный IPv4', () => {
    const verdict = classifyIp('2002:c0a8:101::');
    expect(verdict.isPublic).toBe(false);
    if (!verdict.isPublic) {
      expect(verdict.reason).toContain('192.168.1.1');
      expect(verdict.reason).toContain('2002::/16');
    }
  });
});
