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

// --- Apartments ----------------------------------------------------------------------------------

/** Numbers that Smoobu sometimes sends as strings (prices, coordinates). */
const numeric = z.union([z.number(), z.string()]).nullish();

export const smoobuApartmentListSchema = z.looseObject({
  apartments: z.array(z.looseObject({ id: z.number(), name: z.string().nullish() })),
});
export type SmoobuApartmentList = z.infer<typeof smoobuApartmentListSchema>;

export const smoobuApartmentSchema = z.looseObject({
  // Not in the docs, but present in real responses.
  id: z.number().nullish(),
  name: z.string().nullish(),
  location: z
    .looseObject({
      street: z.string().nullish(),
      zip: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      country: z.string().nullish(),
      // Documented as strings, observed as numbers.
      latitude: numeric,
      longitude: numeric,
    })
    .nullish(),
  timeZone: z.string().nullish(),
  rooms: z.record(z.string(), z.number().nullable()).nullish(),
  // The field table says `amenities` (observed), the docs' example says `equipments`.
  amenities: z.array(z.string()).nullish(),
  equipments: z.array(z.string()).nullish(),
  currency: z.string().nullish(),
  price: z.looseObject({ minimal: numeric, maximal: numeric }).nullish(),
  type: z.looseObject({ id: z.number().nullish(), name: z.string().nullish() }).nullish(),
});
export type SmoobuApartment = z.infer<typeof smoobuApartmentSchema>;

// --- Reservations --------------------------------------------------------------------------------

/**
 * A booking, as returned by GET /api/reservations(/{id}) and reservation webhooks. Hyphenated keys
 * are Smoobu's. Without the key's "Guest Data (PII)" permission, guest fields are empty strings.
 */
export const smoobuBookingSchema = z.looseObject({
  id: z.number(),
  'reference-id': z.string().nullish(),
  /** "reservation" | "modification of booking" | "cancellation". */
  type: z.string().nullish(),
  /** YYYY-MM-DD */
  arrival: z.string(),
  departure: z.string(),
  /** "YYYY-MM-DD HH:MM" */
  'created-at': z.string().nullish(),
  /** "YYYY-MM-DD HH:MM:SS" */
  modifiedAt: z.string().nullish(),
  apartment: z.looseObject({ id: z.number().nullish(), name: z.string().nullish() }).nullish(),
  channel: z
    .looseObject({
      /** The account's channel instance id. */
      id: z.number().nullish(),
      /** The channel type id (14 = Booking.com, 74 = Airbnb…). */
      channel_id: z.number().nullish(),
      name: z.string().nullish(),
    })
    .nullish(),
  'guest-name': z.string().nullish(),
  firstname: z.string().nullish(),
  lastname: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  adults: z.number().nullish(),
  children: z.number().nullish(),
  /** "HH:MM" */
  'check-in': z.string().nullish(),
  'check-out': z.string().nullish(),
  notice: z.string().nullish(),
  'assistant-notice': z.string().nullish(),
  price: numeric,
  'price-details': z.string().nullish(),
  'city-tax': numeric,
  /** "Yes" | "No" */
  'price-paid': z.string().nullish(),
  'commission-included': numeric,
  prepayment: numeric,
  'prepayment-paid': z.string().nullish(),
  deposit: numeric,
  'deposit-paid': z.string().nullish(),
  language: z.string().nullish(),
  'guest-app-url': z.string().nullish(),
  'is-blocked-booking': z.boolean().nullish(),
  guestId: z.number().nullish(),
  related: z.array(z.looseObject({ id: z.number().nullish() })).nullish(),
});
export type SmoobuBooking = z.infer<typeof smoobuBookingSchema>;

export const smoobuBookingsPageSchema = z.looseObject({
  page_count: z.number(),
  page_size: z.number(),
  total_items: z.number(),
  page: z.number(),
  bookings: z.array(smoobuBookingSchema),
});
export type SmoobuBookingsPage = z.infer<typeof smoobuBookingsPageSchema>;

// --- Guests --------------------------------------------------------------------------------------

/** Contact entries are documented as arrays without an item shape: accept strings or objects. */
const contactList = z.array(z.unknown()).nullish();

export const smoobuGuestSchema = z.looseObject({
  id: z.number(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  companyName: z.string().nullish(),
  emails: contactList,
  telephoneNumbers: contactList,
  address: z
    .looseObject({
      street: z.string().nullish(),
      postalCode: z.string().nullish(),
      city: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
  notes: z.string().nullish(),
  bookings: z.array(smoobuBookingSchema).nullish(),
});
export type SmoobuGuest = z.infer<typeof smoobuGuestSchema>;

export const smoobuGuestsPageSchema = z.looseObject({
  pageCount: z.number(),
  pageSize: z.number(),
  totalItems: z.number(),
  page: z.number(),
  guests: z.array(smoobuGuestSchema),
});
export type SmoobuGuestsPage = z.infer<typeof smoobuGuestsPageSchema>;
