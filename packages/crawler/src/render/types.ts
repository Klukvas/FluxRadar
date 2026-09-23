// Contracts of the optional JS rendering step.
//
// A rendered page is a *second* reading of a URL that was already fetched,
// scoped and allowed: the crawler decides what may be visited, the renderer
// only decides what the DOM looked like once the page's own scripts had run.
// Nothing here may widen the crawl.

/**
 * Why a page has no rendered DOM. Every value is reported, never hidden.
 *
 * The values live in a tuple rather than only in the union, because a stored
 * render outcome is read back from the database by a later process and has to
 * be *validated* against this list. A schema that accepted any string there
 * would let an arbitrary value reach the report wearing the union's type.
 */
export const RENDER_FAILURE_REASONS = [
  /** No browser runtime is installed in this deployment. */
  'RuntimeNotInstalled',
  /** The runtime is installed but could not start (no browser binary, sandbox). */
  'RuntimeUnavailable',
  /** The installed runtime is too old to enforce the required traffic controls. */
  'RuntimeTooOld',
  /** The navigation did not finish inside the budget. */
  'NavigationTimeout',
  /** The page's own budgets (subresources/bytes) were exhausted. */
  'BudgetExceeded',
  /** The render was abandoned because the scan was paused or cancelled. */
  'Stopped',
  /** The browser reported an error for this page. */
  'NavigationFailed',
] as const;

export type RenderFailureReason = (typeof RENDER_FAILURE_REASONS)[number];

/** What one render attempt produced. */
export type RenderOutcome =
  | {
      readonly kind: 'rendered';
      /** `document.documentElement.outerHTML` after the page settled. */
      readonly html: string;
      /** How many subresource requests the page was allowed to make. */
      readonly subresourceCount: number;
      /** Bytes of subresource bodies served to the page. */
      readonly subresourceBytes: number;
      /** Requests refused by the render policy, with the reason each was refused. */
      readonly blocked: readonly BlockedRequest[];
      readonly timingMs: number;
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: RenderFailureReason;
      /** Operator-facing detail; never shown as page content. */
      readonly detail: string;
    };

export interface BlockedRequest {
  readonly url: string;
  readonly reason: BlockedRequestReason;
}

export const BLOCKED_REQUEST_REASONS = [
  /** Not GET/HEAD — a render never changes state on the site being audited. */
  'method-not-allowed',
  /** Not an http(s) URL, or carried credentials in the URL. */
  'url-not-allowed',
  /** The SSRF guard refused the host (private address, DNS rebinding attempt). */
  'ssrf-blocked',
  /** robots.txt disallows this resource for our user agent. */
  'robots-disallowed',
  /** A resource kind a DOM reading does not need (image, font, media). */
  'resource-kind',
  /**
   * The page's subresource or byte budget cannot pay for this resource: the
   * request slots are used up, or what remains of the bytes cannot cover a
   * whole response — including a response that turned out to be larger than the
   * per-subresource cap and would otherwise have been served cut short.
   */
  'budget',
  /**
   * The page tried to navigate somewhere — a redirect, a script, a popup. A
   * render reads one URL the crawl already chose; following a navigation would
   * fetch a page the crawl's scope and robots handling never approved.
   */
  'navigation-blocked',
  /** A subresource redirected to a target the policy or robots.txt refuses. */
  'redirect-not-allowed',
  /** The page opened a WebSocket; a render has no use for a live channel. */
  'websocket-blocked',
  /** The scan was paused or cancelled; nothing further is requested. */
  'stopped',
  /** The upstream fetch failed; the browser is told the resource is unavailable. */
  'fetch-failed',
  /**
   * The body arrived compressed and could not be decoded inside the budget.
   * Handing the browser bytes it cannot read would produce a rendered DOM built
   * from a script that never parsed — a wrong answer presented as a right one.
   */
  'encoding-not-decodable',
] as const;

export type BlockedRequestReason = (typeof BLOCKED_REQUEST_REASONS)[number];

/** The page body the crawler already fetched, reused as the render's document. */
export interface RenderDocument {
  readonly html: string;
  readonly contentType: string;
  readonly status: number;
}

export interface RenderRequest {
  readonly url: string;
  readonly userAgent: string;
  /**
   * Serving the navigation from this body is what keeps a rendered scan from
   * asking the site for every page twice. Absent means the browser fetches the
   * document itself, through the same guard as any subresource.
   */
  readonly document?: RenderDocument;
  /**
   * Whether a subresource may be fetched at all. The crawler supplies this so
   * robots.txt and the scan's own scope keep applying inside the browser.
   */
  readonly isSubresourceAllowed?: (url: URL) => Promise<boolean> | boolean;
  /** Returns true once the scan has been paused or cancelled. */
  readonly shouldStop?: () => boolean;
}

/** A started browser. Callers must `close()` it, once, when the scan ends. */
export interface RenderRuntime {
  readonly engine: string;
  readonly version: string;
  render(request: RenderRequest): Promise<RenderOutcome>;
  close(): Promise<void>;
}

/** Starting a runtime either yields one, or says exactly why it could not. */
export type RenderRuntimeResult =
  | { readonly kind: 'ready'; readonly runtime: RenderRuntime }
  | {
      readonly kind: 'unavailable';
      readonly reason: RenderFailureReason;
      readonly detail: string;
    };
