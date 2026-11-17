import { SmoobuClient, type SmoobuClientOptions } from './client';
import { toConversationSummary, toGuest, toMessage, toProperty, toReservation } from './mappers';
import type {
  Account,
  ConversationPage,
  Guest,
  GuestPage,
  MessagePage,
  Page,
  Property,
  PropertySummary,
  Reservation,
  ReservationFilter,
  ReservationPage,
  SendMessageInput,
} from './types';

/**
 * Iterates over every item of a paged endpoint, fetching pages lazily.
 *
 * ```ts
 * for await (const r of paginate((page) => smoobu.reservations.list({ page, pageSize: 100 }))) …
 * ```
 */
export async function* paginate<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
): AsyncGenerator<T> {
  for (let page = 1; ; page++) {
    const res = await fetchPage(page);
    yield* res.items;
    if (page >= res.pageCount || res.items.length === 0) return;
  }
}

/**
 * High-level Smoobu API: speaks the clean domain model (types.ts). Use `.client` for raw,
 * endpoint-level access to anything not covered here yet.
 */
export class Smoobu {
  readonly client: SmoobuClient;

  constructor(options: SmoobuClientOptions | SmoobuClient) {
    this.client = options instanceof SmoobuClient ? options : new SmoobuClient(options);
  }

  /** The account the API key belongs to (GET /api/me). The cheapest credentials check. */
  async getAccount(): Promise<Account> {
    const me = await this.client.getMe();
    return {
      id: me.id,
      firstName: me.firstName ?? null,
      lastName: me.lastName ?? null,
      email: me.email ?? null,
    };
  }

  readonly properties = {
    /** All properties (ids and names). Smoobu calls them apartments. */
    list: async (): Promise<PropertySummary[]> => {
      const res = await this.client.listApartments();
      return res.apartments.map((a) => ({ id: a.id, name: a.name || null }));
    },

    /** One property's details: location, time zone, capacity, amenities, currency. */
    get: async (propertyId: number): Promise<Property> =>
      toProperty(await this.client.getApartment(propertyId), { id: propertyId }),
  };

  readonly reservations = {
    /** Reservations matching the filter, in Smoobu's order. Dates are `YYYY-MM-DD`. */
    list: async (filter: ReservationFilter = {}): Promise<ReservationPage> => {
      const res = await this.client.listReservations({
        page: filter.page,
        pageSize: filter.pageSize,
        apartmentId: filter.propertyId,
        includeRelated: filter.includeRelated,
        from: filter.stayFrom,
        to: filter.stayTo,
        arrivalFrom: filter.arrivalFrom,
        arrivalTo: filter.arrivalTo,
        departureFrom: filter.departureFrom,
        departureTo: filter.departureTo,
        created_from: filter.createdFrom,
        created_to: filter.createdTo,
        modifiedFrom: filter.modifiedFrom,
        modifiedTo: filter.modifiedTo,
        showCancellation: filter.includeCancelled,
        excludeBlocked: filter.includeBlocked === false ? true : undefined,
      });
      return {
        items: res.bookings.map(toReservation),
        page: res.page,
        pageSize: res.page_size,
        pageCount: res.page_count,
        total: res.total_items,
      };
    },

    /** One reservation, with the fields only the single-booking endpoint returns. */
    get: async (reservationId: number): Promise<Reservation> =>
      toReservation(await this.client.getReservation(reservationId)),
  };

  /** Smoobu's guest CRM. Requires the API key's "Guest Data (PII)" permission (403 otherwise). */
  readonly guests = {
    get: async (guestId: number): Promise<Guest> => toGuest(await this.client.getGuest(guestId)),

    /** Searches guests by a free-text query (name, email…). */
    search: async (
      params: { query?: string; page?: number; pageSize?: number } = {},
    ): Promise<GuestPage> => {
      const res = await this.client.listGuests(params);
      return {
        items: res.guests.map(toGuest),
        page: res.page,
        pageSize: res.pageSize,
        pageCount: res.pageCount,
        total: res.totalItems,
      };
    },
  };

  readonly messages = {
    /** Conversations, most recent first, with the latest message of each (GET /api/threads). */
    listConversations: async (
      params: { page?: number; pageSize?: number; propertyIds?: number[] } = {},
    ): Promise<ConversationPage> => {
      const res = await this.client.listThreads({
        page: params.page,
        pageSize: params.pageSize,
        apartmentIds: params.propertyIds,
      });
      return {
        items: res.threads.map(toConversationSummary),
        page: res.page_number,
        pageSize: res.page_size,
        pageCount: res.page_count,
        total: res.total_threads,
        unreadMessages: res.unread_messages ?? null,
      };
    },

    /** Messages of one reservation, oldest first. Smoobu fixes the page size (25). */
    list: async (
      reservationId: number,
      params: { page?: number; onlyRelatedToGuest?: boolean } = {},
    ): Promise<MessagePage> => {
      const res = await this.client.listReservationMessages(reservationId, params);
      return {
        items: res.messages.map((m) => toMessage(reservationId, m)),
        page: res.page,
        pageSize: res.page_size,
        pageCount: res.page_count,
        total: res.total_items,
      };
    },

    /**
     * Sends a message to the guest, or an internal host-only note (audience: 'internal').
     * Smoobu returns no message id: list the reservation's messages to see it.
     */
    send: async ({ reservationId, body, subject, audience = 'guest' }: SendMessageInput) => {
      const payload = { messageBody: body, ...(subject ? { subject } : {}) };
      if (audience === 'internal') {
        await this.client.sendMessageToHost(reservationId, { ...payload, internal: true });
      } else {
        await this.client.sendMessageToGuest(reservationId, payload);
      }
      return { accepted: true as const };
    },
  };
}
