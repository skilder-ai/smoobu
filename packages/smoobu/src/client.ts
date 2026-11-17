import type { z } from 'zod';
import { canonicalQuery, signRequest, type Query } from './auth';
import {
  smoobuErrorSchema,
  smoobuMessagesPageSchema,
  smoobuThreadsPageSchema,
  smoobuUserSchema,
  type SmoobuErrorBody,
  type SmoobuSendMessageBody,
} from './wire';

export interface SmoobuClientOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Extra attempts on 429 / 5xx / network errors (GET only: POSTs are not idempotent). */
  maxRetries?: number;
  /** Sent as User-Agent, e.g. `my-app/1.2.3`. */
  userAgent?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export type SmoobuErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'upstream'
  | 'network';

function errorCode(status: number): SmoobuErrorCode {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 409 || status === 422) return 'validation';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}

/** Any non-2xx answer (or unreachable API). `status` 0 = network/timeout. */
export class SmoobuApiError extends Error {
  override readonly name = 'SmoobuApiError';
  readonly code: SmoobuErrorCode;
  /** Worth retrying later (rate limit, 5xx, network). */
  readonly retryable: boolean;
  constructor(
    readonly status: number,
    message: string,
    readonly body?: SmoobuErrorBody,
    options?: ErrorOptions & { retryAfterMs?: number },
  ) {
    super(message, options);
    this.code = errorCode(status);
    this.retryable = status === 0 || status === 429 || status >= 500;
    this.retryAfterMs = options?.retryAfterMs;
  }
  /** For rate limits: how long until the window resets, when Smoobu says so. */
  readonly retryAfterMs: number | undefined;
}

/** Smoobu answered 2xx but the payload did not match the expected shape. */
export class SmoobuResponseShapeError extends Error {
  override readonly name = 'SmoobuResponseShapeError';
  constructor(
    readonly path: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`Unexpected Smoobu response for ${path}`);
  }
}

interface RequestOptions<T> {
  query?: Query;
  body?: unknown;
  schema: z.ZodType<T>;
}

/**
 * Low-level, typed Smoobu HTTP client. One method per endpoint, returns validated *wire* types.
 * Knows nothing about the domain model (see `Smoobu` for that).
 */
export class SmoobuClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: SmoobuClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://login.smoobu.com').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // --- Endpoints -------------------------------------------------------------------------------

  /** GET /api/me — the account the API key belongs to. Cheapest connectivity check. */
  getMe() {
    return this.request('GET', '/api/me', { schema: smoobuUserSchema });
  }

  /** GET /api/threads — conversation list with the latest message of each booking. */
  listThreads(params: { page?: number; pageSize?: number; apartmentIds?: number[] } = {}) {
    return this.request('GET', '/api/threads', {
      query: {
        page_number: params.page,
        page_size: params.pageSize,
        apartments: params.apartmentIds,
      },
      schema: smoobuThreadsPageSchema,
    });
  }

  /** GET /api/reservations/{id}/messages */
  listReservationMessages(
    reservationId: number,
    params: { page?: number; onlyRelatedToGuest?: boolean } = {},
  ) {
    return this.request('GET', `/api/reservations/${reservationId}/messages`, {
      query: { page: params.page, onlyRelatedToGuest: params.onlyRelatedToGuest },
      schema: smoobuMessagesPageSchema,
    });
  }

  /** POST /api/reservations/{id}/messages/send-message-to-guest (no message id is returned). */
  sendMessageToGuest(reservationId: number, body: Omit<SmoobuSendMessageBody, 'internal'>) {
    return this.request(
      'POST',
      `/api/reservations/${reservationId}/messages/send-message-to-guest`,
      { body, schema: smoobuErrorSchema },
    );
  }

  /** POST /api/reservations/{id}/messages/send-message-to-host (`internal` hides it from the guest). */
  sendMessageToHost(reservationId: number, body: SmoobuSendMessageBody) {
    return this.request(
      'POST',
      `/api/reservations/${reservationId}/messages/send-message-to-host`,
      {
        body,
        schema: smoobuErrorSchema,
      },
    );
  }

  // --- Transport -------------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    { query, body, schema }: RequestOptions<T>,
  ): Promise<T> {
    const qs = canonicalQuery(query);
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    const retries = method === 'GET' ? this.maxRetries : 0;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        // Re-sign on every attempt: nonces are single-use.
        res = await this.fetchFn(url, {
          method,
          headers: {
            Accept: 'application/json',
            ...(this.opts.userAgent ? { 'User-Agent': this.opts.userAgent } : {}),
            ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
            ...signRequest({
              method,
              path,
              query: qs,
              body: rawBody,
              apiKey: this.opts.apiKey,
              apiSecret: this.opts.apiSecret,
            }),
          },
          body: rawBody || undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt < retries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new SmoobuApiError(0, `Smoobu unreachable: ${(err as Error).message}`, undefined, {
          cause: err,
        });
      }

      const json: unknown =
        res.status === 204 ? undefined : await res.json().catch(() => undefined);

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < retries) {
          await this.sleep(retryDelay(res, attempt));
          continue;
        }
        const errBody = smoobuErrorSchema.safeParse(json);
        const parsed = errBody.success ? errBody.data : undefined;
        throw new SmoobuApiError(
          res.status,
          `Smoobu ${method} ${path} failed (${res.status}): ${parsed?.detail || parsed?.title || res.statusText}`,
          parsed,
          { retryAfterMs: res.status === 429 ? retryDelay(res, attempt) : undefined },
        );
      }

      const result = schema.safeParse(json);
      if (!result.success) throw new SmoobuResponseShapeError(path, result.error.issues);
      return result.data;
    }
  }
}

const backoff = (attempt: number) => 500 * 2 ** attempt;

/** X-RateLimit-Retry-After is documented as the window's Unix expiry timestamp. */
function retryDelay(res: Response, attempt: number): number {
  const header = Number(res.headers.get('X-RateLimit-Retry-After'));
  if (res.status === 429 && Number.isFinite(header) && header > 0) {
    const ms = header > 1e9 ? header * 1000 - Date.now() : header * 1000;
    if (ms > 0) return Math.min(ms, 60_000);
  }
  return backoff(attempt);
}
