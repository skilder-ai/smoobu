import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { canonicalQuery, signRequest } from '../src/auth';
import { SmoobuApiError, SmoobuResponseShapeError } from '../src/client';
import { fakeFetch, json, makeClient } from './helpers';

describe('auth', () => {
  it('canonicalises the query: sorted, RFC 3986, arrays as key[]', () => {
    expect(canonicalQuery({ to: '2026-04-10', from: '2026-04-01', skip: undefined })).toBe(
      'from=2026-04-01&to=2026-04-10',
    );
    expect(canonicalQuery({ q: "a b!'" })).toBe('q=a%20b%21%27');
    expect(canonicalQuery({ apartments: [2, 1] })).toBe('apartments%5B%5D=1&apartments%5B%5D=2');
    expect(canonicalQuery()).toBe('');
  });

  it('signs METHOD/PATH/QUERY/TIMESTAMP/NONCE/BODY_HASH/API_KEY with HMAC-SHA256', () => {
    const headers = signRequest({
      method: 'get',
      path: '/api/reservations',
      query: 'from=2026-04-01',
      body: '',
      apiKey: 'key',
      apiSecret: 'secret',
      timestamp: '2026-04-01T12:00:00Z',
      nonce: 'n-1',
    });
    const emptyHash = createHash('sha256').update('').digest('hex');
    expect(emptyHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const canonical = `GET\n/api/reservations\nfrom=2026-04-01\n2026-04-01T12:00:00Z\nn-1\n${emptyHash}\nkey`;
    expect(headers).toEqual({
      'X-API-Key': 'key',
      'X-Timestamp': '2026-04-01T12:00:00Z',
      'X-Nonce': 'n-1',
      'X-Signature': createHmac('sha256', 'secret').update(canonical).digest('base64'),
    });
  });

  it('formats timestamps as ISO 8601 UTC without milliseconds', () => {
    const { 'X-Timestamp': ts } = signRequest({
      method: 'GET',
      path: '/',
      query: '',
      body: '',
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('SmoobuClient', () => {
  it('sends signed requests with the canonical query on the URL', async () => {
    const f = fakeFetch(
      json({
        page_number: 2,
        page_size: 5,
        page_count: 3,
        total_threads: 11,
        unread_messages: 0,
        threads: [],
      }),
    );
    await makeClient(f).listThreads({ page: 2, pageSize: 5 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://login.smoobu.com/api/threads?page_number=2&page_size=5');
    expect(init?.headers).toMatchObject({ 'X-API-Key': 'key' });
    expect(Object.keys(init?.headers ?? {})).toEqual(
      expect.arrayContaining(['X-Timestamp', 'X-Nonce', 'X-Signature']),
    );
  });

  it('never sends the secret over the wire', async () => {
    const f = fakeFetch(json({ id: 7 }));
    await makeClient(f).getMe();
    const [url, init] = f.mock.calls[0]!;
    expect(JSON.stringify([url, init])).not.toContain('secret');
  });

  it('retries GETs on 429 with a fresh nonce, then succeeds', async () => {
    const f = fakeFetch(json({ status: 429 }, 429), json({ id: 7 }));
    await expect(makeClient(f).getMe()).resolves.toMatchObject({ id: 7 });
    expect(f).toHaveBeenCalledTimes(2);
    const nonce = (i: number) =>
      (f.mock.calls[i]![1]?.headers as Record<string, string>)['X-Nonce'];
    expect(nonce(0)).not.toBe(nonce(1));
  });

  it('gives up after maxRetries and reports a retryable rate limit', async () => {
    const f = fakeFetch(...[0, 1, 2].map(() => json({ status: 429 }, 429)));
    const err = await makeClient(f)
      .getMe()
      .catch((e: unknown) => e);
    expect(f).toHaveBeenCalledTimes(3);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryable: true });
  });

  it('never retries POSTs and surfaces the Smoobu error body', async () => {
    const f = fakeFetch(
      json({ status: 400, title: 'Bad Request', detail: 'Failed validation' }, 400),
    );
    const err = await makeClient(f)
      .sendMessageToGuest(1, { messageBody: '' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmoobuApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'validation',
      retryable: false,
      body: { detail: 'Failed validation' },
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('classifies 401 as unauthorized', async () => {
    const f = fakeFetch(
      json({ status: 401, title: 'Unauthorized', detail: 'Authentication required' }, 401),
    );
    await expect(makeClient(f).getMe()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('reports network failures with status 0', async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(makeClient(f).getMe()).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('signs the exact JSON body that is sent', async () => {
    const f = fakeFetch(
      json({ status: 201, title: 'Resource created successfully', detail: '' }, 201),
    );
    await makeClient(f).sendMessageToHost(42, { messageBody: 'hi', internal: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://login.smoobu.com/api/reservations/42/messages/send-message-to-host');
    expect(init?.body).toBe('{"messageBody":"hi","internal":true}');
  });

  it('rejects payloads that do not match the expected shape', async () => {
    const f = fakeFetch(json({ nope: true }));
    await expect(makeClient(f).getMe()).rejects.toBeInstanceOf(SmoobuResponseShapeError);
  });
});
