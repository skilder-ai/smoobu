import {
  conversationPageSchema,
  messageAudienceSchema,
  messageDirectionSchema,
  type Message,
  type MessagePage,
} from '@skilder-ai/smoobu';
import { z } from 'zod';
import { PII_HINT, reservationRowSchema, toRow, type ToolContext } from './context';

const DEFAULT_MAX_CHARS = 2000;

const toolMessageSchema = z.object({
  id: z.number(),
  direction: messageDirectionSchema,
  sentAt: z.string().nullable(),
  subject: z.string().nullable(),
  text: z.string(),
  truncated: z.boolean(),
  html: z.string().nullable().optional(),
});

const reservationIdArg = z.number().int().positive().describe('Smoobu reservation (booking) id.');
const maxCharsArg = z
  .number()
  .int()
  .min(100)
  .max(20_000)
  .default(DEFAULT_MAX_CHARS)
  .describe('Longer message texts are cut and flagged truncated: true.');
const includeHtmlArg = z
  .boolean()
  .default(false)
  .describe('Also return the raw HTML body (verbose; rarely needed).');

function toToolMessage(m: Message, maxChars: number, includeHtml: boolean) {
  return {
    id: m.id,
    direction: m.direction,
    sentAt: m.sentAt,
    subject: m.subject,
    text: m.text.length > maxChars ? m.text.slice(0, maxChars) : m.text,
    truncated: m.text.length > maxChars,
    ...(includeHtml ? { html: m.html } : {}),
  };
}

const chronological = (a: Message, b: Message) =>
  (a.sentAt ?? '').localeCompare(b.sentAt ?? '') || a.id - b.id;

const allEmpty = (items: { text: string; subject: string | null }[]) =>
  items.length > 0 && items.every((m) => !m.text && !m.subject);

const maxId = (p: MessagePage) => Math.max(-1, ...p.items.map((m) => m.id));

export function registerMessageTools({ server, run, smoobu, allowWrites }: ToolContext) {
  server.registerTool(
    'smoobu_list_conversations',
    {
      title: 'List guest conversations',
      description:
        'Lists guest conversations (one per reservation or inquiry), most recent activity first, with a preview of the latest message and the total unread count. reservationId is null for inquiries without a booking; those cannot be opened with smoobu_read_conversation.',
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

  /** Loads the `latest` most recent messages, whichever end of the pagination they are on. */
  async function loadLatest(reservationId: number, latest: number) {
    const first = await smoobu.messages.list(reservationId, { page: 1 });
    const pages = new Map([[1, first]]);
    const { pageCount, total } = first;
    let step = -1;
    let page = pageCount;
    if (pageCount > 1) {
      const last = await smoobu.messages.list(reservationId, { page: pageCount });
      pages.set(pageCount, last);
      // Smoobu does not document the page order: detect which end holds the newest messages.
      if (maxId(first) > maxId(last)) [step, page] = [1, 1];
    } else {
      page = 1;
    }
    const collected: Message[] = [];
    while (collected.length < latest && page >= 1 && page <= pageCount) {
      const res = pages.get(page) ?? (await smoobu.messages.list(reservationId, { page }));
      collected.push(...res.items);
      page += step;
    }
    collected.sort(chronological);
    const trimmed = collected.length > latest;
    const lastLoaded = page - step;
    return {
      messages: collected.slice(-latest),
      total,
      pageCount,
      olderPage: trimmed ? lastLoaded : page >= 1 && page <= pageCount ? page : null,
    };
  }

  server.registerTool(
    'smoobu_read_conversation',
    {
      title: 'Read a conversation',
      description:
        "Reads one reservation's conversation: a header (guest, property, dates, language) and its most recent messages in chronological order, as plain text. inbound = from the guest, outbound = from the host or an automation. To go further back, pass page = olderPage from the previous result (Smoobu pages hold 25 messages; pages may overlap what you already read).",
      inputSchema: {
        reservationId: reservationIdArg,
        latest: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('How many of the most recent messages to return.'),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Read this Smoobu page instead of the latest messages (see olderPage).'),
        includeReservation: z
          .boolean()
          .default(true)
          .describe('Include the reservation header (one extra call).'),
        maxCharsPerMessage: maxCharsArg,
        includeHtml: includeHtmlArg,
      },
      outputSchema: {
        reservationId: z.number(),
        reservation: reservationRowSchema.omit({ reservationId: true }).nullable(),
        messages: z.array(toolMessageSchema),
        total: z.number().describe('Messages in the whole conversation.'),
        pageCount: z.number(),
        olderPage: z
          .number()
          .nullable()
          .describe('Pass as page to read older messages; null when there are none.'),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(
      async ({
        reservationId,
        latest,
        page,
        includeReservation,
        maxCharsPerMessage,
        includeHtml,
      }) => {
        const [conversation, reservation] = await Promise.all([
          page
            ? smoobu.messages.list(reservationId, { page }).then((res) => ({
                messages: [...res.items].sort(chronological),
                total: res.total,
                pageCount: res.pageCount,
                olderPage: null,
              }))
            : loadLatest(reservationId, latest),
          includeReservation
            ? smoobu.reservations.get(reservationId).catch(() => null)
            : Promise.resolve(null),
        ]);
        const messages = conversation.messages.map((m) =>
          toToolMessage(m, maxCharsPerMessage, includeHtml),
        );
        let header = null;
        if (reservation) {
          const { reservationId: _, ...rest } = toRow(reservation);
          header = rest;
        }
        return {
          reservationId,
          reservation: header,
          messages,
          total: conversation.total,
          pageCount: conversation.pageCount,
          olderPage: conversation.olderPage,
          ...(allEmpty(messages) ? { hint: PII_HINT } : {}),
        };
      },
    ),
  );

  server.registerTool(
    'smoobu_list_messages',
    {
      title: 'List messages (deprecated)',
      description:
        "Deprecated: use smoobu_read_conversation, which returns the latest messages and the reservation context. Returns one page of a reservation's messages, oldest first.",
      inputSchema: {
        reservationId: reservationIdArg,
        page: z.number().int().min(1).default(1).describe('1-based page number.'),
        maxCharsPerMessage: maxCharsArg,
        includeHtml: includeHtmlArg,
      },
      outputSchema: {
        reservationId: z.number(),
        items: z.array(toolMessageSchema),
        page: z.number(),
        pageSize: z.number(),
        pageCount: z.number(),
        total: z.number(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async ({ reservationId, page, maxCharsPerMessage, includeHtml }) => {
      const res = await smoobu.messages.list(reservationId, { page });
      const items = res.items.map((m) => toToolMessage(m, maxCharsPerMessage, includeHtml));
      return {
        reservationId,
        items,
        page: res.page,
        pageSize: res.pageSize,
        pageCount: res.pageCount,
        total: res.total,
        ...(allEmpty(items) ? { hint: PII_HINT } : {}),
      };
    }),
  );

  if (!allowWrites) return;

  server.registerTool(
    'smoobu_send_message',
    {
      title: 'Send a message',
      description:
        'Sends a message on a reservation. audience "guest" delivers it to the guest through their booking channel (Airbnb, Booking.com, email…) and cannot be undone: confirm the exact text with the user first, and write in the guest\'s language. audience "internal" adds a host-only note hidden from the guest. Smoobu returns no message id; call smoobu_read_conversation to see it.',
      inputSchema: {
        reservationId: reservationIdArg,
        body: z.string().trim().min(1).max(10_000).describe('Message text (plain text or HTML).'),
        subject: z.string().trim().max(255).optional().describe('Optional subject line.'),
        audience: messageAudienceSchema
          .default('guest')
          .describe('guest = visible to the guest; internal = host-only note.'),
      },
      outputSchema: {
        accepted: z.literal(true),
        reservationId: z.number(),
        audience: messageAudienceSchema,
        note: z.string(),
      },
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
