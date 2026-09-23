// The slice of the Playwright API the render runtime uses, declared here.
//
// `playwright` is an optional runtime dependency: a deployment that does not
// render JS must not have to install a browser. Declaring the surface we use
// keeps this package type-checked and buildable without it, and makes the exact
// API contract we depend on reviewable in one place instead of being implied by
// call sites.

export interface PlaywrightModule {
  readonly chromium: BrowserType;
}

export interface BrowserType {
  launch(options: LaunchOptions): Promise<Browser>;
}

export interface LaunchOptions {
  readonly headless: boolean;
  readonly args?: readonly string[];
  readonly executablePath?: string;
  readonly timeout?: number;
}

export interface Browser {
  version(): string;
  newContext(options: ContextOptions): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface ContextOptions {
  readonly userAgent: string;
  readonly javaScriptEnabled: true;
  readonly acceptDownloads: false;
  readonly bypassCSP: false;
  readonly ignoreHTTPSErrors: false;
  readonly serviceWorkers: 'block';
  readonly extraHTTPHeaders: Readonly<Record<string, string>>;
  readonly permissions: readonly string[];
}

export interface BrowserContext {
  route(pattern: string, handler: (route: Route) => Promise<void> | void): Promise<void>;
  /** Added in Playwright 1.48; absence is why an old runtime is refused. */
  routeWebSocket?(pattern: string, handler: (ws: WebSocketRoute) => void): Promise<void>;
  /**
   * Runs before any page script, in every frame and worker of the context.
   * This is where the egress APIs a route cannot intercept are removed.
   */
  addInitScript(script: string): Promise<void>;
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export interface WebSocketRoute {
  /** The socket the page tried to open; recorded so the report can name it. */
  url?(): string;
  close(options?: { code?: number; reason?: string }): void;
}

export interface Page {
  on(event: 'dialog', handler: (dialog: Dialog) => void): void;
  on(event: 'popup', handler: (page: Page) => void): void;
  on(event: 'download', handler: (download: Download) => void): void;
  goto(url: string, options: GotoOptions): Promise<unknown>;
  waitForLoadState(state: 'networkidle', options: { timeout: number }): Promise<void>;
  waitForTimeout(milliseconds: number): Promise<void>;
  content(): Promise<string>;
  close(): Promise<void>;
}

export interface GotoOptions {
  readonly waitUntil: 'domcontentloaded';
  readonly timeout: number;
}

export interface Dialog {
  dismiss(): Promise<void>;
}

export interface Download {
  cancel(): Promise<void>;
}

export interface Route {
  request(): PlaywrightRequest;
  fulfill(response: FulfillResponse): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface FulfillResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Bytes, not text: a script in another charset must reach the browser intact. */
  readonly body: Buffer;
}

export interface PlaywrightRequest {
  url(): string;
  method(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
}

/** Structural check for the dynamically imported module. */
export function asPlaywrightModule(value: unknown): PlaywrightModule | null {
  if (typeof value !== 'object' || value === null) return null;
  const chromium = (value as { chromium?: unknown }).chromium;
  if (typeof chromium !== 'object' || chromium === null) return null;
  if (typeof (chromium as { launch?: unknown }).launch !== 'function') return null;
  return value as PlaywrightModule;
}
