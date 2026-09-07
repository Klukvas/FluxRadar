// How far the API trusts X-Forwarded-For.
//
// Every IP-scoped rate limit is only as good as `req.ip`, and `req.ip` is
// whatever `trust proxy` says it is. Both mistakes are real:
//
//   Trusting nothing behind Caddy — every request arrives from the proxy's own
//   address, so one bucket holds the whole internet and the first abusive client
//   locks everyone else out (`NODE_ENV` unset in the container is enough to land
//   here, which is exactly why this is no longer decided by `NODE_ENV` alone).
//
//   Trusting everything with no proxy in front — the client picks its own
//   X-Forwarded-For and gets a fresh bucket per request, so the limits do not
//   exist at all.
//
// The setting is therefore an explicit hop count: `TRUST_PROXY=1` for the
// production deployment behind one Caddy, `TRUST_PROXY=false` (or 0) for a
// process exposed directly. Express's blanket `true` is deliberately NOT
// accepted — it is the second mistake spelled as a convenience.

const TRUST_PROXY_ENV = 'TRUST_PROXY';

/**
 * Express `trust proxy` value: a hop count, or false for "no proxy in front".
 * Unset falls back to the previous behaviour — one hop in production, none
 * elsewhere — so an existing deployment keeps working without new variables.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): number | false {
  const raw = env[TRUST_PROXY_ENV]?.trim();
  if (raw === undefined || raw === '') {
    return env.NODE_ENV === 'production' ? 1 : false;
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  const hops = Number(normalized);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(
      `${TRUST_PROXY_ENV} must be a non-negative number of proxy hops, or "false"; ` +
        'a blanket "true" would let any client forge its own address',
    );
  }
  return hops === 0 ? false : hops;
}
