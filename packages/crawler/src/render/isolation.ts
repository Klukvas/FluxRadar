// The controls that stop a rendered page talking to the network on its own.
//
// Intercepting requests is not the same as preventing egress. A route handler
// sees HTTP; it does not see a UDP packet from WebRTC, a beacon flushed during
// unload, or a socket opened inside a worker realm the init script never
// entered. So the controls are layered, and each layer fails closed on its own:
//
//  1. The browser cannot reach the network by itself. Every hostname resolves
//     to nothing and every HTTP(S)/WebSocket connection is pointed at a proxy
//     that does not exist, so a channel no route handler saw does not get out
//     — including one that used a literal IP address and skipped DNS entirely.
//  2. The APIs that can leave without producing an interceptable request are
//     replaced, non-configurably, before the page's first script.
//  3. A dedicated worker is a realm `addInitScript` does not reach, so classic
//     workers are started from a wrapper that runs the same removals inside the
//     worker before the page's own worker code.
//
// Everything here is preventive and belongs to the render only: none of it
// changes what a visitor's browser would do on the site itself.

/**
 * A proxy address that cannot exist: port 0 is not connectable.
 *
 * Nothing legitimate goes through it — every request the render serves is
 * fulfilled by the route handler before Chromium ever reaches for a proxy — so
 * its only effect is that anything which *escaped* interception fails to
 * connect rather than reaching the internet.
 */
const DEAD_PROXY = 'http://127.0.0.1:0';

/**
 * Chromium flags applied to every render, before the operator's own.
 *
 * Deliberately absent: `--no-sandbox`. A container that needs it passes it
 * explicitly (FLUXRADAR_RENDER_CHROMIUM_ARGS), because turning the OS sandbox
 * off while executing a stranger's JavaScript is a decision an operator makes
 * knowingly, not a default they inherit.
 */
export const HARDENED_CHROMIUM_ARGS: readonly string[] = [
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  // Chrome's own phone-home traffic: none of it is the site being audited.
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--disable-client-side-phishing-detection',
  '--metrics-recording-only',
  '--no-pings',
  '--safebrowsing-disable-auto-update',
  // Network containment. The route handler either fulfils a request from
  // safe-fetch's answer or aborts it, so the browser never needs a resolver or
  // a proxy of its own — which means denying it both costs nothing and turns
  // every uncaught channel into a connection error.
  '--host-resolver-rules=MAP * ~NOTFOUND',
  `--proxy-server=${DEAD_PROXY}`,
  // …including for addresses a proxy would normally be skipped for.
  '--proxy-bypass-list=<-loopback>',
  // WebRTC opens UDP that no HTTP route can see. The API is removed in-page as
  // well; this closes the same door at the browser level.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-features=WebRtcAllowInputVolumeAdjustment,MediaRouter,OptimizationHints,Translate',
  '--mute-audio',
];

/**
 * The removals, as a source string that can re-create itself.
 *
 * It takes its own source as an argument so it can build the prelude of a
 * worker script: a dedicated worker is a realm of its own, and a page that
 * cannot open an `EventSource` is not contained if `new Worker(...)` can.
 */
const ISOLATION_FACTORY = `(source) => {
  const refuse = (name) => function () {
    throw new TypeError(name + ' is not available during a FluxRadar render');
  };
  // Non-configurable and non-writable: page code that overwrites a replacement
  // cannot restore the original, but leaving it writable made these advisory.
  const lock = (target, name, value) => {
    try {
      Object.defineProperty(target, name, { configurable: false, writable: false, value });
    } catch {
      // A property the engine refuses to redefine is left as it is; the
      // browser-level containment and the route handler remain in force.
    }
  };
  // WebSocket is deliberately absent: the runtime routes sockets instead, and
  // a Playwright too old to do that is refused rather than run. Its routing
  // replaces this global anyway, so listing it here would only mislead.
  for (const name of [
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'RTCDataChannel',
    'SharedWorker',
    'EventSource',
    'WebTransport',
  ]) {
    if (name in globalThis) lock(globalThis, name, refuse(name));
  }
  if (typeof navigator !== 'undefined') {
    // sendBeacon is fire-and-forget by design: it is flushed on unload, when
    // there is no longer a page for a route handler to belong to.
    lock(navigator, 'sendBeacon', () => false);
  }
  const NativeWorker = globalThis.Worker;
  if (typeof NativeWorker === 'function' && typeof Blob === 'function') {
    const base = typeof location === 'undefined' ? undefined : location.href;
    const hardened = function Worker(scriptUrl, options) {
      // A module worker cannot be prefixed without changing when its own code
      // runs, so it is started as the page asked. The browser-level
      // containment still applies to it; only this layer does not.
      if (options !== undefined && options !== null && options.type === 'module') {
        return new NativeWorker(scriptUrl, options);
      }
      let absolute;
      try {
        absolute = new URL(String(scriptUrl), base).href;
      } catch {
        return new NativeWorker(scriptUrl, options);
      }
      const blob = new Blob(
        [
          '(' + source + ')(' + JSON.stringify(source) + ');',
          'importScripts(' + JSON.stringify(absolute) + ');',
        ],
        { type: 'text/javascript' },
      );
      const blobUrl = URL.createObjectURL(blob);
      try {
        return new NativeWorker(blobUrl, options);
      } finally {
        // Revoked a turn later: the worker has the URL, and holding it forever
        // would leak one object URL per worker the page starts.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      }
    };
    hardened.prototype = NativeWorker.prototype;
    lock(globalThis, 'Worker', hardened);
  }
}`;

/**
 * Removed from every frame — and, through the worker wrapper, every classic
 * worker — before the page's first script.
 *
 * Each of these can reach the network without producing a request a route
 * handler can refuse. They are replaced by a definition that throws or returns
 * failure rather than deleted outright, so a page that feature-detects sees a
 * missing capability instead of a crash mid-render.
 */
export const RENDER_ISOLATION_SCRIPT = `(${ISOLATION_FACTORY})(${JSON.stringify(
  ISOLATION_FACTORY,
)});`;
