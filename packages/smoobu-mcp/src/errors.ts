import { SmoobuApiError, SmoobuResponseShapeError } from '@skilder-ai/smoobu';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const HINTS: Record<SmoobuApiError['code'], string> = {
  unauthorized:
    'Smoobu rejected the credentials. Check that SMOOBU_API_KEY and SMOOBU_API_SECRET belong to the same HMAC key, that the key is not revoked, and that the server clock is correct (±5 minutes).',
  forbidden: 'The API key is not allowed to do this. Check its permissions in Smoobu.',
  not_found: 'Not found: the id does not exist or is not visible to this API key.',
  validation: 'Smoobu rejected the input. Fix the arguments and try again.',
  rate_limited: 'Smoobu rate limit reached (700 requests/minute). Wait before retrying.',
  upstream: 'Smoobu returned a server error. It is usually transient: retry later.',
  network: 'Could not reach Smoobu (network error or timeout). Retry later.',
};

export interface ToolErrorPayload {
  error: true;
  code: string;
  message: string;
  hint: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  details?: unknown;
}

export function describeError(err: unknown): ToolErrorPayload {
  if (err instanceof SmoobuApiError) {
    return {
      error: true,
      code: err.code,
      message: err.message,
      hint: HINTS[err.code],
      retryable: err.retryable,
      ...(err.retryAfterMs ? { retryAfterSeconds: Math.ceil(err.retryAfterMs / 1000) } : {}),
      ...(err.body?.validation_messages ? { details: err.body.validation_messages } : {}),
    };
  }
  if (err instanceof SmoobuResponseShapeError) {
    return {
      error: true,
      code: 'unexpected_response',
      message: err.message,
      hint: 'Smoobu returned data in an unexpected format. This is a bug in smoobu-mcp: please report it.',
      retryable: false,
      details: err.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  return {
    error: true,
    code: 'internal',
    message: err instanceof Error ? err.message : String(err),
    hint: 'Unexpected error in smoobu-mcp.',
    retryable: false,
  };
}

/** Removes any credential value that might have slipped into a string (defence in depth). */
export function makeRedactor(secrets: string[]): (text: string) => string {
  const values = secrets.filter((s) => s.length >= 4);
  return (text) => values.reduce((acc, v) => acc.split(v).join('[REDACTED]'), text);
}

export function errorResult(err: unknown, redact: (t: string) => string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: redact(JSON.stringify(describeError(err), null, 2)) }],
  };
}
