import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  conversationPageSchema,
  messageAudienceSchema,
  messageDirectionSchema,
  Smoobu,
  type SmoobuClientOptions,
} from '@skilder-ai/smoobu';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { errorResult, makeRedactor } from './errors';

export const SERVER_NAME = 'smoobu-mcp';
export const SERVER_VERSION: string = pkg.version;

export interface ServerOptions extends Omit<SmoobuClientOptions, 'userAgent'> {
  /** Registers smoobu_send_message. Off by default: sending reaches real guests. */
  allowWrites?: boolean;
}

const DEFAULT_MAX_CHARS = 2000;

const connectionSchema = z.object({
  connected: z.literal(true),
  account: z.object({ id: z.number(), name: z.string().nullable() }),
  guestDataVisible: z
    .boolean()
    .nullable()
    .describe(
      'false = guest names and message bodies come back empty: enable the "Guest Data (PII)" permission on the API key. null = could not tell (no conversations).',
    ),
  writesEnabled: z.boolean(),
  serverVersion: z.string(),
});

const toolMessageSchema = z.object({
  id: z.number(),
  direction: messageDirectionSchema,
  sentAt: z.string().nullable(),
  subject: z.string().nullable(),
  text: z.string(),
  truncated: z.boolean(),
  html: z.string().nullable().optional(),
});

const messageListSchema = z.object({
  reservationId: z.number(),
  items: z.array(toolMessageSchema),
  page: z.number(),
  pageSize: z.number(),
  pageCount: z.number(),
  total: z.number(),
  hint: z.string().optional(),
});

const sendResultSchema = z.object({
  accepted: z.literal(true),
  reservationId: z.number(),
  audience: messageAudienceSchema,
  note: z.string(),
});

const PII_HINT =
  'All message bodies are empty. The Smoobu API key most likely lacks the "Guest Data (PII)" permission (Smoobu → Settings → Advanced → API Keys).';

/**
 * Builds the MCP server (transport-agnostic). `index.ts` connects it to stdio; embedders can
 * connect it to any other transport.
 */
export function createServer(
  options: ServerOptions | { smoobu: Smoobu; allowWrites?: boolean; secrets?: string[] },
) {
  const smoobu =
    'smoobu' in options
      ? options.smoobu
      : new Smoobu({ ...options, userAgent: `${SERVER_NAME}/${SERVER_VERSION}` });
  const redact = makeRedactor(
    'smoobu' in options ? (options.secrets ?? []) : [options.apiKey, options.apiSecret],
  );
  const allowWrites = options.allowWrites ?? false;

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Smoobu is a vacation-rental channel manager. Conversations are keyed by reservationId. ' +
        'Typical flow: smoobu_list_conversations → smoobu_list_messages(reservationId) → ' +
        (allowWrites
          ? 'smoobu_send_message (always confirm the exact text with the user before sending to a guest).'
          : 'replying is disabled on this server (SMOOBU_ALLOW_WRITES is off).'),
    },
  );

  /** Wraps a handler: structured + text output, typed errors, redaction. */
  const run =
    <A, R extends Record<string, unknown>>(fn: (args: A) => Promise<R>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        const result = await fn(args);
        return {
          structuredContent: result,
          content: [{ type: 'text', text: redact(JSON.stringify(result)) }],
        };
      } catch (err) {
        return errorResult(err, redact);
      }
    };

  server.registerTool(
    'smoobu_check_connection',
    {
      title: 'Check Smoobu connection',
      description:
        'Verifies the Smoobu credentials and reports the account, whether guest data (names, message bodies) is visible to this API key, and whether sending is enabled. Call it first when something fails.',
      inputSchema: {},
      outputSchema: connectionSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async () => {
      const account = await smoobu.getAccount();
      const threads = await smoobu.client.listThreads({ pageSize: 10 });
      const guestDataVisible =
        threads.threads.length === 0
          ? null
          : threads.threads.some(
              (t) =>
                !!t.booking.guest_name ||
                !!t.latest_message?.text_content ||
                !!t.latest_message?.html_content,
            );
      const name = [account.firstName, account.lastName].filter(Boolean).join(' ') || null;
      return {
        connected: true as const,
        account: { id: account.id, name },
        guestDataVisible,
        writesEnabled: allowWrites,
        serverVersion: SERVER_VERSION,
      };
    }),
  );

  server.registerTool(
    'smoobu_list_conversations',
    {
      title: 'List guest conversations',
      description:
        'Lists guest conversations (one per reservation or inquiry), most recent activity first, with a preview of the latest message and the total unread count. reservationId is null for inquiries without a booking; those cannot be opened with smoobu_list_messages.',
      inputSchema: {
        page: z.number().int().min(1).default(1).describe('1-based page number.'),
        pageSize: z.number().int().min(1).max(100).default(20).describe('Conversations per page.'),
        propertyIds: z
          .array(z.number().int().positive())
          .optional()
          .describe('Only conversations for these Smoobu property (apartment) ids.'),
      },
      outputSchema: conversationPageSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run((args) => smoobu.messages.listConversations(args)),
  );

  server.registerTool(
    'smoobu_list_messages',
    {
      title: 'Read a conversation',
      description:
        'Returns the messages of one reservation, oldest first, as plain text. inbound = from the guest, outbound = from the host or an automation. Smoobu pages by 25 messages.',
      inputSchema: {
        reservationId: z.number().int().positive().describe('Smoobu reservation (booking) id.'),
        page: z.number().int().min(1).default(1).describe('1-based page number.'),
        maxCharsPerMessage: z
          .number()
          .int()
          .min(100)
          .max(20_000)
          .default(DEFAULT_MAX_CHARS)
          .describe('Longer message texts are cut and flagged truncated: true.'),
        includeHtml: z
          .boolean()
          .default(false)
          .describe('Also return the raw HTML body (verbose; rarely needed).'),
      },
      outputSchema: messageListSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async ({ reservationId, page, maxCharsPerMessage, includeHtml }) => {
      const res = await smoobu.messages.list(reservationId, { page });
      const items = res.items.map((m) => ({
        id: m.id,
        direction: m.direction,
        sentAt: m.sentAt,
        subject: m.subject,
        text: m.text.length > maxCharsPerMessage ? m.text.slice(0, maxCharsPerMessage) : m.text,
        truncated: m.text.length > maxCharsPerMessage,
        ...(includeHtml ? { html: m.html } : {}),
      }));
      const allEmpty = items.length > 0 && items.every((m) => !m.text && !m.subject);
      return {
        reservationId,
        items,
        page: res.page,
        pageSize: res.pageSize,
        pageCount: res.pageCount,
        total: res.total,
        ...(allEmpty ? { hint: PII_HINT } : {}),
      };
    }),
  );

  if (allowWrites) {
    server.registerTool(
      'smoobu_send_message',
      {
        title: 'Send a message',
        description:
          'Sends a message on a reservation. audience "guest" delivers it to the guest through their booking channel (Airbnb, Booking.com, email…) and cannot be undone: confirm the exact text with the user first. audience "internal" adds a host-only note hidden from the guest. Smoobu returns no message id; call smoobu_list_messages to see it.',
        inputSchema: {
          reservationId: z.number().int().positive().describe('Smoobu reservation (booking) id.'),
          body: z.string().trim().min(1).max(10_000).describe('Message text (plain text or HTML).'),
          subject: z.string().trim().max(255).optional().describe('Optional subject line.'),
          audience: messageAudienceSchema
            .default('guest')
            .describe('guest = visible to the guest; internal = host-only note.'),
        },
        outputSchema: sendResultSchema.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      run(async ({ reservationId, body, subject, audience }) => {
        await smoobu.messages.send({ reservationId, body, subject, audience });
        return {
          accepted: true as const,
          reservationId,
          audience,
          note: 'Accepted by Smoobu. Delivery to the booking channel happens asynchronously.',
        };
      }),
    );
  }

  return server;
}
