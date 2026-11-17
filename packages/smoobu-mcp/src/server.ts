import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Smoobu, type SmoobuClientOptions } from '@skilder-ai/smoobu';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { errorResult, makeRedactor } from './errors';
import type { Runner, ToolContext } from './tools/context';
import { registerMessageTools } from './tools/messages';
import { PropertyDirectory, registerPropertyTools } from './tools/properties';
import { registerReservationTools } from './tools/reservations';

export const SERVER_NAME = 'smoobu-mcp';
export const SERVER_VERSION: string = pkg.version;

export interface ServerOptions extends Omit<SmoobuClientOptions, 'userAgent'> {
  /** Registers smoobu_send_message. Off by default: sending reaches real guests. */
  allowWrites?: boolean;
}

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
        'Smoobu is a vacation-rental channel manager. Properties ("apartments") host reservations; ' +
        'each reservation has one guest conversation, keyed by reservationId. ' +
        'Find a booking with smoobu_find_reservations or smoobu_list_conversations, read it with ' +
        'smoobu_read_conversation, and get guest and stay details with smoobu_get_reservation. ' +
        (allowWrites
          ? 'Reply with smoobu_send_message, in the guest language, after confirming the exact text with the user.'
          : 'Replying is disabled on this server (SMOOBU_ALLOW_WRITES is off).'),
    },
  );

  /** Wraps a handler: structured + text output, typed errors, redaction. */
  const run: Runner =
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

  const ctx: ToolContext = {
    server,
    smoobu,
    run,
    properties: new PropertyDirectory(smoobu),
    allowWrites,
  };
  registerPropertyTools(ctx);
  registerReservationTools(ctx);
  registerMessageTools(ctx);

  return server;
}
