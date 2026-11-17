import { z } from 'zod';

/**
 * Clean, provider-neutral messaging model. Smoobu's wire format (see wire.ts) is mapped to these
 * shapes by mappers.ts so consumers never deal with its inconsistent casing, integer enums,
 * naive dates or empty strings.
 *
 * Timestamps are ISO 8601 *local* date-times without offset (`2026-11-17T10:20:27`): Smoobu
 * returns naive "YYYY-MM-DD HH:MM:SS" values and does not document their timezone.
 */

/** inbound = written by the guest, outbound = written by the host (or an automation). */
export const messageDirectionSchema = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

const localDateTime = z.iso.datetime({ local: true });

export const messageSchema = z.object({
  id: z.number().int(),
  reservationId: z.number().int(),
  direction: messageDirectionSchema,
  subject: z.string().nullable(),
  /** Plain-text body (derived from the HTML body when Smoobu only provides that). */
  text: z.string(),
  /** Raw HTML body when present. Guest-controlled: sanitise before rendering. */
  html: z.string().nullable(),
  sentAt: localDateTime.nullable(),
});
export type Message = z.infer<typeof messageSchema>;

/** One conversation per reservation (or per inquiry, which has no reservation yet). */
export const conversationSummarySchema = z.object({
  /** null for inquiries that have no reservation yet. */
  reservationId: z.number().int().nullable(),
  guestName: z.string().nullable(),
  property: z.object({ id: z.number().int().nullable(), name: z.string().nullable() }).nullable(),
  lastMessage: z
    .object({
      id: z.number().int(),
      subject: z.string().nullable(),
      preview: z.string(),
      sentAt: localDateTime.nullable(),
    })
    .nullable(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** Uniform page envelope (Smoobu uses three different pagination vocabularies). */
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    pageCount: z.number().int(),
    total: z.number().int(),
  });
export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export const conversationPageSchema = pageSchema(conversationSummarySchema).extend({
  unreadMessages: z.number().int().nullable(),
});
export type ConversationPage = z.infer<typeof conversationPageSchema>;

export const messagePageSchema = pageSchema(messageSchema);
export type MessagePage = z.infer<typeof messagePageSchema>;

/** guest = visible to the guest; internal = host-only note on the reservation. */
export const messageAudienceSchema = z.enum(['guest', 'internal']);
export type MessageAudience = z.infer<typeof messageAudienceSchema>;

export interface SendMessageInput {
  reservationId: number;
  /** Plain text or HTML. */
  body: string;
  subject?: string;
  /** Default: guest. */
  audience?: MessageAudience;
}

export interface Account {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}
