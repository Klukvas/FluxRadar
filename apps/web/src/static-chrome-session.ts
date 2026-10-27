export type StaticSession = 'signed-in' | 'anonymous' | 'unavailable';

/** A 401 is a normal visitor; an invalid envelope or outage never enables tabs. */
export async function readStaticSession(fetcher: typeof fetch = fetch): Promise<StaticSession> {
  try {
    const response = await fetcher(
      `${import.meta.env.VITE_API_URL ?? 'http://localhost:3310'}/auth/me`,
      {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      },
    );
    if (response.status === 401) return 'anonymous';
    if (!response.ok) return 'unavailable';
    const envelope: unknown = await response.json();
    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      !('success' in envelope) ||
      envelope.success !== true ||
      !('data' in envelope) ||
      typeof envelope.data !== 'object' ||
      envelope.data === null ||
      !('accountId' in envelope.data) ||
      typeof envelope.data.accountId !== 'string' ||
      envelope.data.accountId.length === 0 ||
      !('email' in envelope.data) ||
      typeof envelope.data.email !== 'string'
    )
      return 'unavailable';
    return 'signed-in';
  } catch {
    return 'unavailable';
  }
}
