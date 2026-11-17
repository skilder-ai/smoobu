import { vi } from 'vitest';
import { SmoobuClient } from '../src/client';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A fetch stub answering from a queue and recording calls. */
export function fakeFetch(...responses: Response[]) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  });
}

export const makeClient = (fetchFn: typeof fetch) =>
  new SmoobuClient({ apiKey: 'key', apiSecret: 'secret', fetch: fetchFn, sleep: async () => {} });
