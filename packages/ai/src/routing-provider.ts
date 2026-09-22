// One AiProvider over several adapters (D-233). Every caller — runAiRequest,
// the GEO module, the UX module — still takes a single provider; which vendor
// answers is a property of the request, not of the wiring.

import { AiModuleError } from './errors.js';
import type {
  AiProvider,
  AiProviderConfig,
  AiProviderName,
  AiRequest,
  NormalizedAiResponse,
} from './types.js';

export class RoutingAiProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly adapters: ReadonlyMap<AiProviderName, AiProvider>;

  constructor(adapters: readonly AiProvider[]) {
    const [first] = adapters;
    if (first === undefined) {
      throw new AiModuleError('ai: routing provider needs at least one adapter');
    }
    const byName = new Map<AiProviderName, AiProvider>();
    for (const adapter of adapters) {
      const { provider } = adapter.config;
      if (byName.has(provider)) {
        throw new AiModuleError(`ai: routing provider has two adapters for "${provider}"`);
      }
      byName.set(provider, adapter);
    }
    this.adapters = byName;
    // Callers that read a single config (timeouts, api version) predate routing
    // and only ever ask about the provider they are about to use; the first
    // adapter is the registry's first provider and the honest default.
    this.config = first.config;
  }

  /** The provider names this router can serve, in registry order. */
  get providers(): readonly AiProviderName[] {
    return [...this.adapters.keys()];
  }

  /** The adapter that would serve this provider, or null when none would. */
  adapterFor(provider: AiProviderName): AiProvider | null {
    return this.adapters.get(provider) ?? null;
  }

  async send(request: AiRequest, promptText: string): Promise<NormalizedAiResponse> {
    const adapter = this.adapters.get(request.provider);
    if (adapter === undefined) {
      // A request aimed at a provider nobody wired is a bug in the caller, not
      // an outage: turning it into Unavailable would quietly drop the questions.
      throw new AiModuleError(
        `ai: no adapter routes "${request.provider}" (have ${this.providers.join(', ')})`,
      );
    }
    return adapter.send(request, promptText);
  }
}
