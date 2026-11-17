import {
  reservationSchema,
  SmoobuApiError,
  type Reservation,
  type ReservationFilter,
} from '@skilder-ai/smoobu';
import { z } from 'zod';
import {
  guestDataHidden,
  isoDateArg,
  PII_HINT,
  reservationRowSchema,
  toRow,
  type ToolContext,
} from './context';

const GUEST_SEARCH_LIMIT = 20;

const findArgs = {
  guestName: z
    .string()
    .trim()
    .min(2)
    .optional()
    .describe(
      'Search by guest name (or email) through Smoobu\'s guest records. Needs the "Guest Data (PII)" key permission.',
    ),
  propertyId: z.number().int().positive().optional().describe('Only this property.'),
  stayingFrom: isoDateArg
    .optional()
    .describe('Stays overlapping [stayingFrom, stayingTo]. Same date twice = staying that day.'),
  stayingTo: isoDateArg.optional(),
  arrivalFrom: isoDateArg.optional(),
  arrivalTo: isoDateArg.optional(),
  departureFrom: isoDateArg.optional(),
  departureTo: isoDateArg.optional(),
  includeCancelled: z.boolean().default(false),
  includeBlocked: z
    .boolean()
    .default(false)
    .describe('Include dates blocked by the host (no guest).'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
};
type FindArgs = { [K in keyof typeof findArgs]: z.infer<(typeof findArgs)[K]> };

/** Local equivalent of Smoobu's filters, for reservations obtained through guest records. */
function matches(r: Reservation, a: FindArgs): boolean {
  const { arrival, departure } = r.stay;
  if (a.propertyId && r.property?.id !== a.propertyId) return false;
  if (!a.includeCancelled && r.status === 'cancelled') return false;
  if (!a.includeBlocked && r.status === 'blocked') return false;
  if (a.stayingFrom && departure < a.stayingFrom) return false;
  if (a.stayingTo && arrival > a.stayingTo) return false;
  if (a.arrivalFrom && arrival < a.arrivalFrom) return false;
  if (a.arrivalTo && arrival > a.arrivalTo) return false;
  if (a.departureFrom && departure < a.departureFrom) return false;
  if (a.departureTo && departure > a.departureTo) return false;
  return true;
}

const guestProfileSchema = z.object({
  id: z.number(),
  companyName: z.string().nullable(),
  notes: z.string().nullable().describe("The host's CRM notes about this guest."),
  otherReservations: z.array(reservationRowSchema).describe('Past and future stays, newest first.'),
});

export function registerReservationTools({ server, run, smoobu, properties }: ToolContext) {
  server.registerTool(
    'smoobu_find_reservations',
    {
      title: 'Find reservations',
      description:
        'Finds reservations by dates (arrivals, departures, stays overlapping a period), property, status or guest name. Returns compact rows; use smoobu_get_reservation for one booking in full and smoobu_read_conversation for its messages. Example: guests staying today = stayingFrom and stayingTo set to today.',
      inputSchema: findArgs,
      outputSchema: {
        items: z.array(reservationRowSchema),
        page: z.number(),
        pageSize: z.number(),
        pageCount: z.number(),
        total: z.number(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async (a: FindArgs) => {
      if (a.guestName) {
        const guests = await smoobu.guests.search({
          query: a.guestName,
          pageSize: GUEST_SEARCH_LIMIT,
        });
        const seen = new Set<number>();
        const all = guests.items
          .flatMap((g) => g.reservations)
          .filter((r) => !seen.has(r.id) && seen.add(r.id) && matches(r, a))
          .sort((x, y) => y.stay.arrival.localeCompare(x.stay.arrival));
        const start = (a.page - 1) * a.pageSize;
        return {
          items: all.slice(start, start + a.pageSize).map(toRow),
          page: a.page,
          pageSize: a.pageSize,
          pageCount: Math.max(1, Math.ceil(all.length / a.pageSize)),
          total: all.length,
          ...(guests.total > GUEST_SEARCH_LIMIT
            ? { hint: `More than ${GUEST_SEARCH_LIMIT} guests match: refine guestName.` }
            : {}),
        };
      }
      const filter: ReservationFilter = {
        page: a.page,
        pageSize: a.pageSize,
        propertyId: a.propertyId,
        stayFrom: a.stayingFrom,
        stayTo: a.stayingTo,
        arrivalFrom: a.arrivalFrom,
        arrivalTo: a.arrivalTo,
        departureFrom: a.departureFrom,
        departureTo: a.departureTo,
        includeCancelled: a.includeCancelled,
        includeBlocked: a.includeBlocked,
      };
      const res = await smoobu.reservations.list(filter);
      const items = res.items.map(toRow);
      return {
        ...res,
        items,
        ...(guestDataHidden(items) ? { hint: PII_HINT } : {}),
      };
    }),
  );

  server.registerTool(
    'smoobu_get_reservation',
    {
      title: 'Get a reservation and its guest',
      description:
        "Everything about one booking, for answering a guest: stay dates and check-in/out times, guests count, language, notes, payment status, the property (with its time zone) and the guest's profile (host notes, other stays). Contact details (email, phone) are left out unless includeContact is true.",
      inputSchema: {
        reservationId: z.number().int().positive().describe('Smoobu reservation (booking) id.'),
        includeGuestProfile: z
          .boolean()
          .default(true)
          .describe("Also load the guest's CRM record (one extra call)."),
        includeContact: z.boolean().default(false).describe('Include the guest email and phone.'),
      },
      outputSchema: {
        reservation: reservationSchema,
        property: z
          .object({
            id: z.number(),
            name: z.string().nullable(),
            city: z.string().nullable(),
            country: z.string().nullable(),
            timeZone: z.string().nullable(),
            currency: z.string().nullable(),
          })
          .nullable(),
        guestProfile: guestProfileSchema.nullable(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async ({ reservationId, includeGuestProfile, includeContact }) => {
      const r = await smoobu.reservations.get(reservationId);
      const reservation = includeContact
        ? r
        : { ...r, guest: { ...r.guest, email: null, phone: null } };

      const [property, guest] = await Promise.allSettled([
        r.property ? properties.get(r.property.id) : Promise.resolve(null),
        includeGuestProfile && r.guest.id ? smoobu.guests.get(r.guest.id) : Promise.resolve(null),
      ]);
      const p = property.status === 'fulfilled' ? property.value : null;
      const g = guest.status === 'fulfilled' ? guest.value : null;

      const hints: string[] = [];
      if (r.status !== 'blocked' && !r.guest.name) hints.push(PII_HINT);
      if (property.status === 'rejected') hints.push('Property details unavailable right now.');
      if (guest.status === 'rejected') {
        const e = guest.reason;
        if (!(e instanceof SmoobuApiError) || !['forbidden', 'not_found'].includes(e.code)) {
          throw e;
        }
        hints.push(`Guest profile unavailable (${e.code}).`);
      }

      return {
        reservation,
        property: p && {
          id: p.id,
          name: p.name,
          city: p.location.city,
          country: p.location.country,
          timeZone: p.timeZone,
          currency: p.currency,
        },
        guestProfile: g && {
          id: g.id,
          companyName: g.companyName,
          notes: g.notes,
          otherReservations: g.reservations
            .filter((o) => o.id !== r.id)
            .sort((x, y) => y.stay.arrival.localeCompare(x.stay.arrival))
            .map(toRow),
        },
        ...(hints.length ? { hint: [...new Set(hints)].join(' ') } : {}),
      };
    }),
  );
}
