// The integration providers a user connects themselves. Kept in its own module
// so configuration readers can name a provider without importing the composed
// integration config (and the cycle that would create).

export const USER_INTEGRATION_PROVIDERS = ['google', 'bing'] as const;
export type UserIntegrationProvider = (typeof USER_INTEGRATION_PROVIDERS)[number];

export function isUserIntegrationProvider(value: string): value is UserIntegrationProvider {
  return USER_INTEGRATION_PROVIDERS.includes(value as UserIntegrationProvider);
}
