// One AiProvider over several adapters, dispatching on `request.provider`.
//
// `runAiRequest`, `runGeoModule` and the UX module still take a single provider;
// asking two models the same questions is a routing concern, not a pipeline one.

import { AiModuleError, UnavailableError } from './errors.js';
import type { AiProvider, AiProviderConfig, AiProviderName, AiRequest } from './types.js';
import type { NormalizedAiResponse } from './types.js';

export class RoutingAiProvider implements AiProvider {
  private readonly byName: ReadonlyMap<AiProviderName, AiProvider>;

  constructor(providers: readonly AiProvider[]) {
    if (providers.length === 0) {
      throw new AiModuleError('ai: routing provider needs at least one adapter');
    }
    const byName = new Map<AiProviderName, AiProvider>();
    for (const provider of providers) {
      if (byName.has(provider.config.provider)) {
        throw new AiModuleError(
          `ai: routing provider has two adapters for "${provider.config.provider}"`,
        );
      }
      byName.set(provider.config.provider, provider);
    }
    this.byName = byName;
  }

  /** The first adapter's config; callers that need one name read `providers`. */
  get config(): AiProviderConfig {
    const first = [...this.byName.values()][0];
    if (first === undefined) throw new AiModuleError('ai: routing provider has no adapters');
    return first.config;
  }

  get providers(): readonly AiProviderName[] {
    return [...this.byName.keys()];
  }

  configFor(provider: AiProviderName): AiProviderConfig | null {
    return this.byName.get(provider)?.config ?? null;
  }

  async send(
    request: AiRequest,
    promptText: string,
    signal?: AbortSignal,
  ): Promise<NormalizedAiResponse> {
    const provider = this.byName.get(request.provider);
    if (provider === undefined) {
      // Routing a request to a provider nobody wired is a bug in the caller, not
      // one of §5's legal unavailable branches.
      throw new AiModuleError(
        `ai: no adapter for provider "${request.provider}" ` +
          `(wired: ${this.providers.join(', ')})`,
      );
    }
    return provider.send(request, promptText, signal);
  }
}

/**
 * Production must never turn a missing external key into a fake visibility
 * result. Keeping the refusal as an AiProvider lets the normal pipeline record
 * `ProviderUnavailable`, release quota, and keep the scan itself alive.
 */
export class UnconfiguredProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly displayName: string;

  constructor(
    provider: AiProviderName,
    modelId: string,
    apiVersion: string,
    displayName: string = provider,
  ) {
    this.displayName = displayName;
    this.config = { provider, apiVersion, modelId, timeoutMs: 15_000, maxRetries: 1 };
  }

  async send(): Promise<never> {
    throw new UnavailableError(`${this.displayName} API key is not configured`);
  }
}
