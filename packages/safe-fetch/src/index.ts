// @fluxradar/safe-fetch — SSRF-защищённый fetch-слой (T-05).
// Общая инфраструктура crawler/reliability/rules: план §6, D-028, D-030, D-125..D-129.

export {
  NetworkError,
  RedirectLimitError,
  SafeFetchError,
  SsrfBlockedError,
  TimeoutError,
  UrlValidationError,
} from './errors.js';
export type { BlockedIpCategory, IpClassification } from './ip-guard.js';
export { classifyIp, isPublicIp } from './ip-guard.js';
export type { HostLimiterOptions, ReleaseFn } from './rate-limit.js';
export { HostLimiter } from './rate-limit.js';
export type { DnsResolver } from './resolver.js';
export { stripIpv6Brackets, systemDnsResolver } from './resolver.js';
export type { RedirectHop, SafeFetchOptions, SafeFetchResult } from './safe-fetch.js';
export { safeFetch } from './safe-fetch.js';
