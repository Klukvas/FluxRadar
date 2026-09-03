// DNS-резолв для SSRF-гарда: интерфейс инъектируемый (тесты подставляют мок),
// по умолчанию — системный lookup (A+AAAA разом, тот же путь, что у net.connect).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface DnsResolver {
  /** Все адреса хоста (A+AAAA); IP-литерал возвращается как есть без DNS. */
  resolveAll(host: string): Promise<readonly string[]>;
}

/** URL.hostname отдаёт IPv6 в скобках (`[::1]`) — срезаем для net/dns API. */
export function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export const systemDnsResolver: DnsResolver = {
  async resolveAll(host: string): Promise<readonly string[]> {
    const bare = stripIpv6Brackets(host);
    if (isIP(bare) !== 0) {
      return [bare];
    }
    const entries = await lookup(bare, { all: true });
    return entries.map((entry) => entry.address);
  },
};
