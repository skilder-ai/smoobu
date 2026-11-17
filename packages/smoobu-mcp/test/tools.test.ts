import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Smoobu, SmoobuClient } from '@skilder-ai/smoobu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apartment,
  booking,
  bookingsPage,
  guest,
  message,
  messagesPage,
} from '../../smoobu/test/fixtures';
import { createServer } from '../src/server';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Route = (url: URL) => unknown;

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

/** Connects a client to a server whose fetch answers by path (`GET /api/...`). */
async function connect(routes: Record<string, Route | unknown>) {
  const fetchFn = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (!(url.pathname in routes)) throw new Error(`unexpected request ${url.pathname}`);
    const route = routes[url.pathname];
    const body = typeof route === 'function' ? (route as Route)(url) : route;
    return body instanceof Response ? body : json(body);
  });
  const smoobu = new Smoobu(
    new SmoobuClient({ apiKey: 'k', apiSecret: 's', fetch: fetchFn, sleep: async () => {} }),
  );
  const server = createServer({ smoobu });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client!.callTool({ name, arguments: args })) as CallToolResult;
    if (res.isError) throw new Error((res.content[0] as { text: string }).text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions on loose tool output
    return res.structuredContent as Record<string, any>;
  };
  const paths = () => fetchFn.mock.calls.map((c) => new URL(String(c[0])).pathname);
  return { call, fetchFn, paths };
}

describe('property tools', () => {
  it('lists properties with details, then serves them from cache', async () => {
    const { call, fetchFn } = await connect({
      '/api/apartments': {
        apartments: [
          { id: 10, name: 'Chalet Alpha' },
          { id: 11, name: 'B' },
        ],
      },
      '/api/apartments/10': apartment(),
      '/api/apartments/11': apartment({ id: 11, name: 'B', location: { city: 'Aigle' } }),
    });
    const res = await call('smoobu_list_properties');
    expect(res.total).toBe(2);
    expect(res.items[0]).toEqual({
      id: 10,
      name: 'Chalet Alpha',
      type: 'Holiday rental',
      city: 'Leysin',
      country: 'Switzerland',
      timeZone: 'Europe/Zurich',
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 1,
      currency: 'CHF',
    });
    expect(res.items[1].city).toBe('Aigle');

    const calls = fetchFn.mock.calls.length;
    await call('smoobu_list_properties');
    await call('smoobu_get_property', { propertyId: 11 });
    expect(fetchFn.mock.calls.length).toBe(calls);
  });
});

describe('smoobu_find_reservations', () => {
  it('maps filters to Smoobu, hides blocked dates, returns compact rows', async () => {
    let query: Record<string, string> = {};
    const { call } = await connect({
      '/api/reservations': (url: URL) => {
        query = Object.fromEntries(url.searchParams);
        return bookingsPage([booking()]);
      },
    });
    const res = await call('smoobu_find_reservations', {
      stayingFrom: '2026-12-21',
      stayingTo: '2026-12-21',
    });
    expect(query).toEqual({
      from: '2026-12-21',
      to: '2026-12-21',
      excludeBlocked: 'true',
      showCancellation: 'false',
      page: '1',
      pageSize: '20',
    });
    expect(res.items).toEqual([
      {
        reservationId: 100,
        status: 'confirmed',
        property: { id: 10, name: 'Chalet Alpha' },
        arrival: '2026-12-20',
        departure: '2026-12-27',
        nights: 7,
        guestName: 'Anna Muster',
        adults: 2,
        children: 1,
        channel: 'Airbnb',
        language: 'fr',
      },
    ]);
    expect(res).not.toHaveProperty('hint');
  });

  it('hints at the PII permission when guest names are blank', async () => {
    const { call } = await connect({
      '/api/reservations': bookingsPage([booking({ 'guest-name': '' })]),
    });
    expect((await call('smoobu_find_reservations')).hint).toMatch(/Guest Data \(PII\)/);
  });

  it('searches by guest name through guest records and filters locally', async () => {
    const { call } = await connect({
      '/api/guests': (url: URL) => {
        expect(url.searchParams.get('query')).toBe('Muster');
        return {
          pageCount: 1,
          pageSize: 20,
          totalItems: 1,
          page: 1,
          guests: [
            guest({
              bookings: [
                booking({ id: 1, arrival: '2025-07-01', departure: '2025-07-05' }),
                booking({ id: 2, arrival: '2026-12-20', departure: '2026-12-27' }),
                booking({ id: 3, type: 'cancellation' }),
              ],
            }),
          ],
        };
      },
    });
    const res = await call('smoobu_find_reservations', { guestName: 'Muster' });
    expect(res.items.map((r: { reservationId: number }) => r.reservationId)).toEqual([2, 1]);
    const recent = await call('smoobu_find_reservations', {
      guestName: 'Muster',
      arrivalFrom: '2026-01-01',
    });
    expect(recent.total).toBe(1);
  });
});

describe('smoobu_get_reservation', () => {
  it('combines booking, property and guest profile, without contact details by default', async () => {
    const { call } = await connect({
      '/api/reservations/100': booking(),
      '/api/apartments/10': apartment(),
      '/api/guests/77': guest({
        bookings: [booking(), booking({ id: 90, arrival: '2025-01-02' })],
      }),
    });
    const res = await call('smoobu_get_reservation', { reservationId: 100 });
    expect(res.reservation.guest).toMatchObject({ name: 'Anna Muster', email: null, phone: null });
    expect(res.reservation.notes.assistant).toBe('Late arrival');
    expect(res.property).toMatchObject({ city: 'Leysin', timeZone: 'Europe/Zurich' });
    expect(res.guestProfile).toMatchObject({ id: 77, notes: 'Prefers French' });
    expect(
      res.guestProfile.otherReservations.map((r: { reservationId: number }) => r.reservationId),
    ).toEqual([90]);

    const withContact = await call('smoobu_get_reservation', {
      reservationId: 100,
      includeContact: true,
    });
    expect(withContact.reservation.guest.email).toBe('anna@example.com');
  });

  it('still answers when the guest profile is forbidden', async () => {
    const { call } = await connect({
      '/api/reservations/100': booking({ 'guest-name': '' }),
      '/api/apartments/10': apartment(),
      '/api/guests/77': json({ status: 403, title: 'Forbidden' }, 403),
    });
    const res = await call('smoobu_get_reservation', { reservationId: 100 });
    expect(res.guestProfile).toBeNull();
    expect(res.hint).toMatch(/Guest Data \(PII\).*Guest profile unavailable \(forbidden\)/);
  });
});

describe('smoobu_read_conversation', () => {
  const pages = (pageCount: number, perPage: number[][]) => (url: URL) => {
    const page = Number(url.searchParams.get('page') ?? 1);
    const ids = perPage[page - 1]!;
    const total = perPage.flat().length;
    return messagesPage(
      ids.map((id) => message(id, `2026-11-${String(id).padStart(2, '0')} 10:00:00`)),
      page,
      pageCount,
      total,
    );
  };

  it('returns the latest messages with a reservation header (oldest page first)', async () => {
    const { call } = await connect({
      '/api/reservations/100/messages': pages(2, [
        [1, 2, 3],
        [4, 5],
      ]),
      '/api/reservations/100': booking(),
    });
    const res = await call('smoobu_read_conversation', { reservationId: 100, latest: 3 });
    expect(res.messages.map((m: { id: number }) => m.id)).toEqual([3, 4, 5]);
    expect(res.total).toBe(5);
    expect(res.olderPage).toBe(1);
    expect(res.reservation).toMatchObject({ guestName: 'Anna Muster', language: 'fr' });
  });

  it('detects newest-first pagination', async () => {
    const { call } = await connect({
      '/api/reservations/100/messages': pages(3, [[9, 8], [7, 6], [5]]),
    });
    const res = await call('smoobu_read_conversation', {
      reservationId: 100,
      latest: 3,
      includeReservation: false,
    });
    expect(res.messages.map((m: { id: number }) => m.id)).toEqual([7, 8, 9]);
    expect(res.olderPage).toBe(2);
    expect(res.reservation).toBeNull();
  });

  it('reads all messages of a single page without older pages', async () => {
    const { call } = await connect({
      '/api/reservations/100/messages': pages(1, [[1, 2]]),
      '/api/reservations/100': booking(),
    });
    const res = await call('smoobu_read_conversation', { reservationId: 100 });
    expect(res.messages.map((m: { id: number }) => m.id)).toEqual([1, 2]);
    expect(res.olderPage).toBeNull();
  });
});
