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

// --- Properties ----------------------------------------------------------------------------------

/** YYYY-MM-DD */
const isoDate = z.iso.date();
/** HH:MM */
const timeOfDay = z.string().regex(/^\d{2}:\d{2}$/);

/** A rental unit. Smoobu calls these "apartments". */
export const propertySummarySchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
});
export type PropertySummary = z.infer<typeof propertySummarySchema>;

export const propertySchema = propertySummarySchema.extend({
  /** e.g. "Holiday rental". */
  type: z.string().nullable(),
  location: z.object({
    street: z.string().nullable(),
    zip: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  }),
  /** IANA zone, e.g. "Europe/Zurich". */
  timeZone: z.string().nullable(),
  capacity: z.object({
    maxGuests: z.number().int().nullable(),
    bedrooms: z.number().int().nullable(),
    bathrooms: z.number().nullable(),
    beds: z.object({
      double: z.number().int().nullable(),
      single: z.number().int().nullable(),
      queen: z.number().int().nullable(),
      king: z.number().int().nullable(),
      sofa: z.number().int().nullable(),
      couch: z.number().int().nullable(),
      child: z.number().int().nullable(),
    }),
  }),
  amenities: z.array(z.string()),
  currency: z.string().nullable(),
  /** Nightly price range configured in Smoobu. */
  priceRange: z.object({ min: z.number().nullable(), max: z.number().nullable() }),
});
export type Property = z.infer<typeof propertySchema>;

// --- Reservations --------------------------------------------------------------------------------

/**
 * confirmed = a live booking; modified = changed after creation; cancelled; blocked = dates
 * blocked by the host (no guest).
 */
export const reservationStatusSchema = z.enum(['confirmed', 'modified', 'cancelled', 'blocked']);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

export const reservationSchema = z.object({
  id: z.number().int(),
  /** The booking channel's own reference (e.g. the Airbnb confirmation code). */
  reference: z.string().nullable(),
  status: reservationStatusSchema,
  property: propertySummarySchema.nullable(),
  channel: z
    .object({
      /** Channel type: 14 = Booking.com, 74 = Airbnb, 13 = direct booking… */
      typeId: z.number().int().nullable(),
      name: z.string().nullable(),
    })
    .nullable(),
  stay: z.object({
    arrival: isoDate,
    departure: isoDate,
    nights: z.number().int().nullable(),
    checkInTime: timeOfDay.nullable(),
    checkOutTime: timeOfDay.nullable(),
    adults: z.number().int().nullable(),
    children: z.number().int().nullable(),
  }),
  /** Empty (nulls) unless the API key has the "Guest Data (PII)" permission. */
  guest: z.object({
    id: z.number().int().nullable(),
    name: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    /** Locale code such as "en" or "fr". */
    language: z.string().nullable(),
  }),
  notes: z.object({
    /** Note entered with the booking (often the guest's own message). */
    guest: z.string().nullable(),
    /** Host/assistant note. Only returned when fetching one reservation. */
    assistant: z.string().nullable(),
  }),
  /** Amounts are in the property's currency. */
  payment: z.object({
    total: z.number().nullable(),
    paid: z.boolean().nullable(),
    prepayment: z.number().nullable(),
    prepaymentPaid: z.boolean().nullable(),
    deposit: z.number().nullable(),
    depositPaid: z.boolean().nullable(),
    cityTax: z.number().nullable(),
    channelCommission: z.number().nullable(),
    /** One "name - currency amount" line per price element. */
    details: z.string().nullable(),
  }),
  guestAppUrl: z.string().nullable(),
  /** Other properties this booking also blocks (grouped units). */
  relatedPropertyIds: z.array(z.number().int()),
  createdAt: localDateTime.nullable(),
  modifiedAt: localDateTime.nullable(),
});
export type Reservation = z.infer<typeof reservationSchema>;

export const reservationPageSchema = pageSchema(reservationSchema);
export type ReservationPage = z.infer<typeof reservationPageSchema>;

/** Filters for `reservations.list`. Dates are `YYYY-MM-DD`; every range bound is inclusive. */
export interface ReservationFilter {
  page?: number;
  /** 1–100. Smoobu's default is 25. */
  pageSize?: number;
  propertyId?: number;
  /** Also return bookings of grouped properties (needs propertyId). */
  includeRelated?: boolean;
  /** Stays overlapping [stayFrom, stayTo]. Use the same date for "staying on that day". */
  stayFrom?: string;
  stayTo?: string;
  arrivalFrom?: string;
  arrivalTo?: string;
  departureFrom?: string;
  departureTo?: string;
  createdFrom?: string;
  createdTo?: string;
  modifiedFrom?: string;
  modifiedTo?: string;
  /** Default false: Smoobu leaves cancelled bookings out. */
  includeCancelled?: boolean;
  /** Default true (Smoobu's default): host-blocked dates are returned as status "blocked". */
  includeBlocked?: boolean;
}

// --- Guests --------------------------------------------------------------------------------------

/** Smoobu's guest CRM record. Only available with the "Guest Data (PII)" key permission. */
export const guestSchema = z.object({
  id: z.number().int(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  address: z
    .object({
      street: z.string().nullable(),
      postalCode: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  /** The host's CRM notes about this guest. */
  notes: z.string().nullable(),
  reservations: z.array(reservationSchema),
});
export type Guest = z.infer<typeof guestSchema>;

export const guestPageSchema = pageSchema(guestSchema);
export type GuestPage = z.infer<typeof guestPageSchema>;
