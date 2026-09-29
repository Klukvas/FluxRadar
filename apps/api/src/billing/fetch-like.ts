// The shape of `fetch` every provider client depends on instead of the global,
// so tests can substitute a stub without touching module-level state.
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<Response>;
