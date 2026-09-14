// The URLs of the workspace screens that carry no identifier.
//
// App.tsx routes by them, and the site header links to them from public pages
// that cannot switch the app's screen. One table keeps the two from drifting:
// a renamed route used to leave the header pointing at the old address.

export const WORKSPACE_PATHS = {
  desktop: '/profiles',
  'new-scan': '/scan',
  reports: '/reports',
  integrations: '/integrations',
} as const;

export type WorkspaceTabScreen = keyof typeof WORKSPACE_PATHS;
