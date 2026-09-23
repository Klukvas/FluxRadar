// The FastSpring half of an outbound refund: `POST /returns`.
//
// THE CONTRACT, READ OFF FASTSPRING'S OWN REFERENCE (developer.fastspring.com —
// Returns, "Create a return"). Every name below is theirs, verbatim:
//
//   request   { "returns": [ { "order": "<order id or reference>",
//                              "reason": <enum>, "note": "<customer visible>",
//                              "notification": "ORIGINAL" | "NONE",
//                              "refundType": "FULL" | "PARTIAL",
//                              "items": [ { "product": "...", "amount": n } ] } ] }
//   response  { "returns": [ { "return": "<return id>", "reference": "...",
//                              "completed": true, "currency": "USD",
//                              "totalReturn": 5, "result": "success",
//                              "action": "return.create" } ] }
//   refusal   200 or 400 with the same envelope and
//             { "result": "error", "error": { "<field>": "<message>" } }
//
// `items` is documented as required for a PARTIAL refund and ignored for a FULL
// one. THIS ADAPTER ONLY EVER SENDS `refundType: "FULL"`. A partial return has to
// be stated per product, in the order's own currency, against the amount still
// returnable on that line — three facts this repository does not hold with enough
// confidence to put money behind. Anything that is not a full return of the whole
// order is left to an operator (see dispatcher.ts).
//
// THERE IS NO IDEMPOTENCY KEY IN THIS API. FastSpring documents none, and the
// stable key FluxRadar carries is therefore only ours: it deduplicates our own
// records and cannot make a repeat submission safe. That is why an unanswered
// call ends as `uncertain` and is never retried automatically.
//
// The reason enum is closed, and FastSpring's documented behaviour for a value
// outside it is to create the return with reason `None` — a silent downgrade. So
// the mapping below only ever emits documented values.

import { z } from 'zod';

import type { FastSpringConfig } from '../fastspring/config.ts';
import { FASTSPRING_PROVIDER } from '../fastspring/config.ts';
import type {
  RefundProviderAdapter,
  RefundSubmission,
  RefundSubmissionOutcome,
} from './provider.ts';

/** A money write is not something to keep waiting on; it is also not retried. */
export const RETURNS_REQUEST_TIMEOUT_MS = 20_000;

const USER_AGENT = 'FluxRadar/0.1 (+https://fluxradar.net)';

/** FastSpring's documented `reason` values. Nothing outside this list is sent. */
export const FASTSPRING_RETURN_REASONS = [
  'DUPLICATE_ORDER',
  'PRODUCT_NOT_RECEIVED',
  'FRAUDULENT',
  'TAX_REFUND',
  'ORDER_ERROR',
  'PRODUCT_DIFFERENCE',
  'DISCOUNT',
  'COMPATIBILITY_ISSUE',
  'OTHER',
  'NONE',
] as const;

export type FastSpringReturnReason = (typeof FASTSPRING_RETURN_REASONS)[number];

/**
 * FluxRadar's four reason codes (§18) in FastSpring's vocabulary.
 *
 * The first three all mean the same thing to a payment provider: the buyer paid
 * for an audit and did not get one. `LEGAL_SUPPORT` is a decision of ours that
 * FastSpring has no code for, so it is `OTHER` rather than a code that would
 * misdescribe it.
 */
const REASON_BY_CODE: Readonly<Record<string, FastSpringReturnReason>> = {
  PRE_QUEUE_CANCEL: 'PRODUCT_NOT_RECEIVED',
  PLATFORM_FAILURE_AFTER_RETRY: 'PRODUCT_NOT_RECEIVED',
  EXTERNAL_NO_USABLE_OUTPUT: 'PRODUCT_NOT_RECEIVED',
  LEGAL_SUPPORT: 'OTHER',
};

export function fastSpringReasonFor(reasonCode: string): FastSpringReturnReason {
  return REASON_BY_CODE[reasonCode] ?? 'OTHER';
}

/**
 * `ORIGINAL` — FastSpring notifies the buyer at the address they paid with.
 *
 * The provider is the party that took the money and the party whose name is on
 * the buyer's statement, so its own notice is the one that will be recognised.
 * `NONE` would refund a card silently, which reads as a fraudulent-looking
 * credit to the buyer and produces the support ticket the refund was meant to
 * close.
 */
const NOTIFICATION = 'ORIGINAL';

const returnLineSchema = z.object({
  return: z.string().min(1).optional(),
  reference: z.string().min(1).optional(),
  completed: z.boolean().optional(),
  currency: z.string().optional(),
  totalReturn: z.number().optional(),
  result: z.string().optional(),
  error: z.record(z.string(), z.unknown()).optional(),
});

const returnsResponseSchema = z.object({ returns: z.array(returnLineSchema).min(1) });

export interface FastSpringReturnsDeps {
  readonly config: FastSpringConfig;
  /** Test seam; production uses the global fetch. */
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The request body, exported so a contract test can assert on it by name. */
export function returnsRequestBody(
  submission: RefundSubmission,
): Readonly<Record<string, unknown>> {
  return {
    returns: [
      {
        order: submission.providerOrderId,
        reason: fastSpringReasonFor(submission.reasonCode),
        notification: NOTIFICATION,
        refundType: 'FULL',
      },
    ],
  };
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

/** The provider's own words for a refusal, as one line, with no secret in it. */
function refusalReason(line: z.infer<typeof returnLineSchema>): string {
  const error = line.error ?? {};
  const stated = Object.entries(error)
    .map(([field, message]) => `${field}: ${typeof message === 'string' ? message : 'refused'}`)
    .join('; ');
  return stated === '' ? 'FastSpring refused the return without naming a field' : stated;
}

export function fastSpringReturnsAdapter(deps: FastSpringReturnsDeps): RefundProviderAdapter {
  const fetcher = deps.fetcher ?? fetch;
  const timeoutMs = deps.timeoutMs ?? RETURNS_REQUEST_TIMEOUT_MS;
  return {
    provider: FASTSPRING_PROVIDER,
    async submit(submission: RefundSubmission): Promise<RefundSubmissionOutcome> {
      const url = `${deps.config.apiBaseUrl}/returns`;
      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: {
            Authorization: basicAuthHeader(deps.config.apiUsername, deps.config.apiPassword),
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify(returnsRequestBody(submission)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // The thrown value can embed the request, and the request carries the
        // Authorization header, so it is never forwarded or logged. A request
        // that did not visibly complete may still have been executed.
        return {
          outcome: 'uncertain',
          reason: 'FastSpring could not be reached, or did not answer in time',
        };
      }
      const text = await response.text().catch(() => '');
      // 401/403/5xx are the two ends of the same problem: nothing in the body can
      // be trusted to say what happened to the money.
      if (response.status >= 500) {
        return { outcome: 'uncertain', reason: `FastSpring answered HTTP ${response.status}` };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          outcome: 'refused',
          reason: `FastSpring rejected the API credentials (HTTP ${response.status})`,
        };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        return {
          outcome: 'uncertain',
          reason: `FastSpring answered HTTP ${response.status} with a body that is not JSON`,
        };
      }
      const parsed = returnsResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          outcome: 'uncertain',
          reason: `FastSpring answered HTTP ${response.status} outside the documented envelope`,
        };
      }
      const line = parsed.data.returns[0];
      if (line === undefined) {
        return { outcome: 'uncertain', reason: 'FastSpring returned an empty returns list' };
      }
      if (line.result === 'error') {
        return { outcome: 'refused', reason: refusalReason(line) };
      }
      if (line.result !== 'success' || line.return === undefined) {
        // A body that neither refuses nor names a return id: the return may exist
        // and we cannot address it. That is exactly `uncertain`.
        return {
          outcome: 'uncertain',
          reason: 'FastSpring answered without a return id or a result we recognise',
        };
      }
      return {
        outcome: 'submitted',
        providerRefundId: line.return,
        providerReference: line.reference ?? null,
        completedByProvider: line.completed === true,
        providerReasonCode: fastSpringReasonFor(submission.reasonCode),
      };
    },
  };
}
