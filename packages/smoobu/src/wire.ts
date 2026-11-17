import { z } from 'zod';

/**
 * Raw Smoobu wire formats. These mirror Smoobu's JSON exactly — including its inconsistent
 * casing — and are deliberately lenient (loose objects, optional fields): the docs are known to
 * disagree with real payloads. Exported as `wire` for advanced use; prefer the domain types
 * (types.ts) produced by mappers.ts.
 */

export const smoobuErrorSchema = z.looseObject({
  status: z.number().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  validation_messages: z.record(z.string(), z.unknown()).optional(),
});
export type SmoobuErrorBody = z.infer<typeof smoobuErrorSchema>;

export const smoobuUserSchema = z.looseObject({
  id: z.number(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  email: z.string().nullish(),
});
export type SmoobuUser = z.infer<typeof smoobuUserSchema>;

export const smoobuMessageSchema = z.looseObject({
  id: z.number(),
  subject: z.string().nullish(),
  message: z.string().nullish(),
  // The docs' example says `messageHtml`, the field table says `htmlMessage`: accept both.
  messageHtml: z.string().nullish(),
  htmlMessage: z.string().nullish(),
  /** 1 = inbox (received from the guest), 2 = outbox (sent by the host). */
  type: z.number(),
  /** "YYYY-MM-DD HH:MM:SS" (observed; undocumented), timezone not stated. */
  createdAt: z.string().nullish(),
});
export type SmoobuMessage = z.infer<typeof smoobuMessageSchema>;

export const smoobuMessagesPageSchema = z.looseObject({
  page_count: z.number(),
  page_size: z.number(),
  total_items: z.number(),
  page: z.number(),
  messages: z.array(smoobuMessageSchema),
});
export type SmoobuMessagesPage = z.infer<typeof smoobuMessagesPageSchema>;

export const smoobuThreadSchema = z.looseObject({
  // Observed in production: some threads (inquiries?) have `booking.id` and `apartment.id` = null.
  booking: z.looseObject({ id: z.number().nullable(), guest_name: z.string().nullish() }),
  apartment: z.looseObject({ id: z.number().nullable(), name: z.string().nullish() }).nullish(),
  latest_message: z
    .looseObject({
      id: z.number(),
      subject: z.string().nullish(),
      text_content: z.string().nullish(),
      html_content: z.string().nullish(),
      /** "YYYY-MM-DD HH:MM:SS", timezone not documented. */
      created_at: z.string().nullish(),
    })
    .nullish(),
});
export type SmoobuThread = z.infer<typeof smoobuThreadSchema>;

export const smoobuThreadsPageSchema = z.looseObject({
  page_number: z.number(),
  page_size: z.number(),
  page_count: z.number(),
  total_threads: z.number(),
  unread_messages: z.number().nullish(),
  threads: z.array(smoobuThreadSchema),
});
export type SmoobuThreadsPage = z.infer<typeof smoobuThreadsPageSchema>;

export interface SmoobuSendMessageBody {
  subject?: string;
  /** HTML or plain text. */
  messageBody: string;
  /** Host messages only: hidden from the guest when true. */
  internal?: boolean;
}

/** Envelope of every webhook call. `data` depends on `action`. */
export const smoobuWebhookSchema = z.looseObject({
  action: z.string(),
  user: z.number(),
  data: z.unknown(),
});
export const smoobuNewMessageDataSchema = z.looseObject({
  id: z.number(),
  sender: z.string().nullish(),
  booking: z.looseObject({ id: z.number() }),
});
