import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Smoobu, SmoobuClient } from '@skilder-ai/smoobu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { createServer } from '../src/server';

const KEY = 'test-key-1234';
const SECRET = 'test-secret-5678';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const threadsPage = (threads: unknown[]) =>
  json({
    page_number: 1,
    page_size: 10,
    page_count: 1,
    total_threads: threads.length,
    unread_messages: 2,
    threads,
  });

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(responses: Response[], allowWrites = false) {
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  });
  const smoobu = new Smoobu(
    new SmoobuClient({ apiKey: KEY, apiSecret: SECRET, fetch: fetchFn, sleep: async () => {} }),
  );
  const server = createServer({ smoobu, allowWrites, secrets: [KEY, SECRET] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client!.callTool({ name, arguments: args })) as CallToolResult;
  return { client, call, fetchFn };
}

describe('config', () => {
  it('requires both key and secret, without echoing values', () => {
    expect(() => loadConfig({ SMOOBU_API_KEY: KEY })).toThrow(/Missing SMOOBU_API_SECRET/);
    expect(() => loadConfig({ SMOOBU_API_KEY: KEY })).not.toThrow(KEY);
    expect(() => loadConfig({})).toThrow(/SMOOBU_API_KEY and SMOOBU_API_SECRET/);
  });

  it('keeps writes off unless explicitly enabled', () => {
    const base = { SMOOBU_API_KEY: KEY, SMOOBU_API_SECRET: SECRET };
    expect(loadConfig(base).allowWrites).toBe(false);
    expect(loadConfig({ ...base, SMOOBU_ALLOW_WRITES: 'true' }).allowWrites).toBe(true);
  });

  it('rejects non-https base URLs', () => {
    expect(() =>
      loadConfig({ SMOOBU_API_KEY: KEY, SMOOBU_API_SECRET: SECRET, SMOOBU_BASE_URL: 'http://x' }),
    ).toThrow(/https/);
  });
});

describe('tools', () => {
  it('exposes read-only tools, and no send tool unless writes are allowed', async () => {
    const { client } = await connect([]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'smoobu_check_connection',
      'smoobu_list_conversations',
      'smoobu_list_messages',
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it('registers smoobu_send_message when writes are allowed', async () => {
    const { client } = await connect([], true);
    const { tools } = await client.listTools();
    const send = tools.find((t) => t.name === 'smoobu_send_message');
    expect(send?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  });

  it('check_connection flags a key without guest-data permission', async () => {
    const { call } = await connect([
      json({ id: 7, firstName: 'Ada', lastName: 'L', email: 'a@b.c' }),
      threadsPage([
        {
          booking: { id: 1, guest_name: '' },
          apartment: null,
          latest_message: { id: 2, text_content: '', html_content: '' },
        },
      ]),
    ]);
    const res = await call('smoobu_check_connection');
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      connected: true,
      account: { id: 7, name: 'Ada L' },
      guestDataVisible: false,
      writesEnabled: false,
    });
  });

  it('list_messages truncates long texts and hints when everything is empty', async () => {
    const msg = (id: number, message: string) => ({
      id,
      subject: '',
      message,
      htmlMessage: '',
      type: 1,
      createdAt: '2026-11-17 10:00:00',
    });
    const page = (messages: unknown[]) =>
      json({ page_count: 1, page_size: 25, total_items: messages.length, page: 1, messages });
    const { call } = await connect([page([msg(1, 'x'.repeat(150))]), page([msg(2, '')])]);

    const long = await call('smoobu_list_messages', { reservationId: 5, maxCharsPerMessage: 100 });
    expect(long.structuredContent).toMatchObject({
      reservationId: 5,
      items: [{ id: 1, direction: 'inbound', truncated: true, sentAt: '2026-11-17T10:00:00' }],
    });
    expect((long.structuredContent as { items: { text: string }[] }).items[0]!.text).toHaveLength(
      100,
    );
    expect(long.structuredContent).not.toHaveProperty('hint');

    const empty = await call('smoobu_list_messages', { reservationId: 5 });
    expect(empty.structuredContent).toHaveProperty(
      'hint',
      expect.stringContaining('Guest Data (PII)'),
    );
  });

  it('validates arguments before calling Smoobu', async () => {
    const { call, fetchFn } = await connect([]);
    const res = await call('smoobu_list_messages', { reservationId: -1 });
    expect(res.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns actionable, redacted errors', async () => {
    const { call } = await connect([
      json({ status: 401, title: 'Unauthorized', detail: `bad key ${KEY}` }, 401),
    ]);
    const res = await call('smoobu_list_conversations');
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({
      code: 'unauthorized',
      retryable: false,
      hint: expect.stringContaining('HMAC'),
    });
  });

  it('send_message routes to Smoobu and reports acceptance', async () => {
    const { call, fetchFn } = await connect(
      [json({ status: 201, title: 'Resource created successfully', detail: '' }, 201)],
      true,
    );
    const res = await call('smoobu_send_message', { reservationId: 5, body: 'Welcome!' });
    expect(res.structuredContent).toMatchObject({
      accepted: true,
      reservationId: 5,
      audience: 'guest',
    });
    expect(String(fetchFn.mock.calls[0]![0])).toMatch(/send-message-to-guest$/);
  });
});
