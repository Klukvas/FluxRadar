// What Creem appends to the return URL when it sends the buyer back.
//
// After payment Creem redirects the browser to the deployment's return URL with
// these query parameters (docs.creem.io — Checkout API, "Handling Successful
// Payments"). None of them grants anything: the browser polls the checkout
// status by our own reference, and the scan exists only because the signed
// webhook created it. They are listed here for the one thing that has to know
// their names besides the web app — the reverse proxy's access log, which
// deletes them so a checkout id, an order id and Creem's signature over them are
// never written to disk (deploy/Caddyfile, DEPLOY-018).

export const CREEM_RETURN_QUERY_KEYS = [
  'checkout_id',
  'order_id',
  'customer_id',
  'subscription_id',
  'product_id',
  'request_id',
  'signature',
] as const;

/** The parameter that carries our own checkout reference back. */
export const CREEM_RETURN_REFERENCE_PARAM = 'request_id';
