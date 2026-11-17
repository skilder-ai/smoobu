import { createHash, createHmac, randomUUID } from 'node:crypto';

/**
 * Smoobu HMAC request signing (https://docs.smoobu.com/ → Authentication).
 *
 * canonical = METHOD \n PATH \n QUERY \n TIMESTAMP \n NONCE \n sha256hex(BODY) \n API_KEY
 * X-Signature = base64(hmacSha256(secret, canonical))
 *
 * QUERY is sorted and RFC 3986 encoded (spaces → %20, brackets → %5B%5D); it is an empty line
 * when there are no parameters. The exact same query string must be sent on the wire.
 */

export type QueryValue =
  string | number | boolean | undefined | null | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

/** encodeURIComponent leaves !'()* untouched; RFC 3986 reserves them. */
const rfc3986 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Builds the sorted, RFC 3986-encoded query string (without the leading `?`). */
export function canonicalQuery(query: Query = {}): string {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) pairs.push([`${key}[]`, String(item)]);
    } else {
      pairs.push([key, String(value)]);
    }
  }
  return pairs
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export interface SignInput {
  method: string;
  path: string;
  /** Already canonicalised query string (see canonicalQuery). */
  query: string;
  /** Raw request body exactly as sent ('' for none). */
  body: string;
  apiKey: string;
  apiSecret: string;
  /** Injectable for tests. */
  timestamp?: string;
  nonce?: string;
}

export function signRequest(input: SignInput): Record<string, string> {
  // ISO 8601 UTC without milliseconds, e.g. 2026-04-01T12:00:00Z
  const timestamp = input.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = input.nonce ?? randomUUID();
  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    input.query,
    timestamp,
    nonce,
    bodyHash,
    input.apiKey,
  ].join('\n');
  const signature = createHmac('sha256', input.apiSecret).update(canonical).digest('base64');
  return {
    'X-API-Key': input.apiKey,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
}
