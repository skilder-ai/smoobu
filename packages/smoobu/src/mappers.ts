import { htmlToText } from './html';
import type {
  ConversationSummary,
  Guest,
  Message,
  Property,
  Reservation,
  ReservationStatus,
} from './types';
import type {
  SmoobuApartment,
  SmoobuBooking,
  SmoobuGuest,
  SmoobuMessage,
  SmoobuThread,
} from './wire';

/** "YYYY-MM-DD HH:MM[:SS]" → "YYYY-MM-DDTHH:MM:SS"; anything unexpected → null. */
export function toLocalDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(value.trim());
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}` : null;
}

const emptyToNull = (v: string | null | undefined) => (v ? v : null);

export function toMessage(reservationId: number, m: SmoobuMessage): Message {
  const html = emptyToNull(m.htmlMessage ?? m.messageHtml);
  return {
    id: m.id,
    reservationId,
    // Smoobu: 1 = inbox (from guest), 2 = outbox (from host). Unknown types count as outbound.
    direction: m.type === 1 ? 'inbound' : 'outbound',
    subject: emptyToNull(m.subject),
    text: m.message || (html ? htmlToText(html) : ''),
    html,
    sentAt: toLocalDateTime(m.createdAt),
  };
}

export function toConversationSummary(t: SmoobuThread): ConversationSummary {
  const latest = t.latest_message;
  const text =
    latest?.text_content || (latest?.html_content ? htmlToText(latest.html_content) : '');
  return {
    reservationId: t.booking.id,
    guestName: emptyToNull(t.booking.guest_name),
    property: t.apartment ? { id: t.apartment.id, name: emptyToNull(t.apartment.name) } : null,
    lastMessage: latest
      ? {
          id: latest.id,
          subject: emptyToNull(latest.subject),
          preview: text.slice(0, 200),
          sentAt: toLocalDateTime(latest.created_at),
        }
      : null,
  };
}

/** Numbers Smoobu may send as strings; empty or invalid → null. */
const toNumber = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Smoobu's "Yes" / "No" strings. */
const yesNo = (v: string | null | undefined): boolean | null =>
  v === 'Yes' ? true : v === 'No' ? false : null;

const isoDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const timeOfDay = (v: string | null | undefined) => (v && /^\d{2}:\d{2}$/.test(v) ? v : null);

function nightsBetween(arrival: string, departure: string): number | null {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

export function toProperty(
  a: SmoobuApartment,
  fallback: { id: number; name?: string | null },
): Property {
  const rooms = a.rooms ?? {};
  const int = (k: string) => toNumber(rooms[k]);
  return {
    id: a.id ?? fallback.id,
    name: emptyToNull(a.name ?? fallback.name),
    type: emptyToNull(a.type?.name),
    location: {
      street: emptyToNull(a.location?.street),
      zip: emptyToNull(a.location?.zip),
      city: emptyToNull(a.location?.city),
      state: emptyToNull(a.location?.state),
      country: emptyToNull(a.location?.country),
      latitude: toNumber(a.location?.latitude),
      longitude: toNumber(a.location?.longitude),
    },
    timeZone: emptyToNull(a.timeZone),
    capacity: {
      maxGuests: int('maxOccupancy'),
      bedrooms: int('bedrooms'),
      bathrooms: int('bathrooms'),
      beds: {
        double: int('doubleBeds'),
        single: int('singleBeds'),
        queen: int('queenSizeBeds'),
        king: int('kingSizeBeds'),
        sofa: int('sofaBeds'),
        couch: int('couches'),
        child: int('childBeds'),
      },
    },
    amenities: (a.amenities ?? a.equipments ?? []).filter(Boolean),
    currency: emptyToNull(a.currency),
    priceRange: { min: toNumber(a.price?.minimal), max: toNumber(a.price?.maximal) },
  };
}

function toStatus(b: SmoobuBooking): ReservationStatus {
  if (b['is-blocked-booking']) return 'blocked';
  if (b.type === 'cancellation') return 'cancelled';
  if (b.type === 'modification of booking') return 'modified';
  return 'confirmed';
}

export function toReservation(b: SmoobuBooking): Reservation {
  const arrival = isoDate(b.arrival) ?? b.arrival;
  const departure = isoDate(b.departure) ?? b.departure;
  return {
    id: b.id,
    reference: emptyToNull(b['reference-id']),
    status: toStatus(b),
    property:
      b.apartment?.id != null ? { id: b.apartment.id, name: emptyToNull(b.apartment.name) } : null,
    channel: b.channel
      ? { typeId: b.channel.channel_id ?? null, name: emptyToNull(b.channel.name) }
      : null,
    stay: {
      arrival,
      departure,
      nights: nightsBetween(arrival, departure),
      checkInTime: timeOfDay(b['check-in']),
      checkOutTime: timeOfDay(b['check-out']),
      adults: b.adults ?? null,
      children: b.children ?? null,
    },
    guest: {
      id: b.guestId ?? null,
      name: emptyToNull(b['guest-name']?.trim()),
      firstName: emptyToNull(b.firstname),
      lastName: emptyToNull(b.lastname),
      email: emptyToNull(b.email),
      phone: emptyToNull(b.phone),
      language: emptyToNull(b.language),
    },
    notes: { guest: emptyToNull(b.notice), assistant: emptyToNull(b['assistant-notice']) },
    payment: {
      total: toNumber(b.price),
      paid: yesNo(b['price-paid']),
      prepayment: toNumber(b.prepayment),
      prepaymentPaid: yesNo(b['prepayment-paid']),
      deposit: toNumber(b.deposit),
      depositPaid: yesNo(b['deposit-paid']),
      cityTax: toNumber(b['city-tax']),
      channelCommission: toNumber(b['commission-included']),
      details: emptyToNull(b['price-details']),
    },
    guestAppUrl: emptyToNull(b['guest-app-url']),
    relatedPropertyIds: (b.related ?? []).flatMap((r) => (r.id != null ? [r.id] : [])),
    createdAt: toLocalDateTime(b['created-at']),
    modifiedAt: toLocalDateTime(b.modifiedAt),
  };
}

/** Contact entries: plain strings, or objects carrying the value under a common key. */
function contactValues(list: unknown[] | null | undefined): string[] {
  return (list ?? []).flatMap((e) => {
    if (typeof e === 'string') return e ? [e] : [];
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      const v = o.email ?? o.number ?? o.telephoneNumber ?? o.value;
      return typeof v === 'string' && v ? [v] : [];
    }
    return [];
  });
}

export function toGuest(g: SmoobuGuest): Guest {
  const addr = g.address;
  const address =
    addr && (addr.street || addr.postalCode || addr.city || addr.country)
      ? {
          street: emptyToNull(addr.street),
          postalCode: emptyToNull(addr.postalCode),
          city: emptyToNull(addr.city),
          country: emptyToNull(addr.country),
        }
      : null;
  return {
    id: g.id,
    firstName: emptyToNull(g.firstName),
    lastName: emptyToNull(g.lastName),
    companyName: emptyToNull(g.companyName),
    emails: contactValues(g.emails),
    phones: contactValues(g.telephoneNumbers),
    address,
    notes: emptyToNull(g.notes),
    reservations: (g.bookings ?? []).map(toReservation),
  };
}
