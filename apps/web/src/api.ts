// Local FluxRadar API runs on 3310 because 3000 is occupied by another local service.
// Deployments should always provide VITE_API_URL explicitly.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3310';

export interface ApiResult<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

const TECHNICAL_ERROR =
  /^(request failed|failed to fetch|networkerror|typeerror|fetch error|http\s*\d+)/i;

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new Error('FluxRadar is temporarily unavailable. Try again in a moment.');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/csv') && response.ok) {
    return (await response.text()) as T;
  }
  let envelope: ApiResult<T> | null = null;
  try {
    envelope = (await response.json()) as ApiResult<T>;
  } catch {
    // Non-JSON responses are converted into a safe product message below.
  }
  if (!response.ok || envelope?.success !== true) {
    const backendMessage = envelope?.error?.message;
    const message =
      backendMessage && !TECHNICAL_ERROR.test(backendMessage)
        ? backendMessage
        : friendlyStatusMessage(response.status);
    throw new Error(message);
  }
  return envelope.data as T;
}

function friendlyStatusMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  if (status === 403) return 'This action is not available for the current plan or account.';
  if (status === 404) return 'FluxRadar could not find the requested item.';
  if (status === 409) return 'This action conflicts with the current scan state.';
  if (status === 429) return 'Too many attempts. Try again later.';
  if (status >= 500) return 'FluxRadar is temporarily unavailable. Try again in a moment.';
  return 'FluxRadar could not complete this request. Try again.';
}

export interface Account {
  readonly accountId: string;
  readonly email: string;
  readonly internalFreeAccess?: boolean;
}

export interface SiteProfile {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly language?: string | null;
}

export interface ScanModule {
  readonly module: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly coverage: number | null;
  readonly score: number | null;
  readonly applicableChecks: number | null;
  readonly completedApplicableChecks: number | null;
  readonly usableOutput: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Scan {
  readonly id: string;
  readonly profileId: string;
  readonly plan: 'Free' | 'Basic' | 'Complete';
  readonly domain: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly scope: {
    readonly includeSubdomains: boolean;
    readonly maxPages?: number;
    readonly maxDepth?: number;
    readonly urlPatterns?: readonly string[];
    readonly excludePatterns?: readonly string[];
    readonly queryPolicy?: 'include' | 'ignore';
    readonly respectRobots?: boolean;
    readonly robotsOverrideConfirmed?: boolean;
    readonly userAgent?: 'desktop' | 'mobile';
  };
  readonly rulesetVersion: string;
  readonly progress: { readonly completedModules: number; readonly totalModules: number };
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly modules: readonly ScanModule[];
}

export interface Issue {
  readonly id: string;
  readonly scanId: string;
  readonly ruleId: string;
  readonly module: string;
  readonly fingerprint: string;
  readonly severity: string;
  readonly category: string;
  readonly status: string;
  readonly targetUrl: string;
  readonly evidenceType: string;
  readonly evidenceRef: string;
  readonly evidenceExcerpt: string | null;
  readonly recommendation: string;
  readonly confidence: number;
  readonly affectedTargets: number;
  readonly applicableTargets: number;
  readonly rulePenalty: number;
  readonly scoreDelta: number;
  readonly observedAt: string;
}

export interface Dashboard {
  readonly scan: Scan;
  readonly overall: {
    readonly verdict: string;
    readonly score: number | null;
    readonly weightedCoverage: number;
    readonly moduleWeights: readonly {
      module: string;
      tariffWeight: number;
      effectiveWeight: number;
    }[];
  };
  readonly modules: readonly ScanModule[];
}

export interface ExportPayload {
  readonly scanId: string;
  readonly records: readonly Record<string, unknown>[];
}

export interface IntegrationStatus {
  readonly provider: string;
  readonly label: string;
  readonly kind: 'user' | 'platform';
  readonly status: 'connected' | 'available' | 'not_configured' | 'needs_reconnect' | 'limited';
  readonly services: readonly string[];
  readonly canConnect: boolean;
  readonly lastCheckedAt: string | null;
  readonly lastError: string | null;
}
