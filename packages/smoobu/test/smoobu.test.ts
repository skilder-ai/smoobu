import { describe, expect, it } from 'vitest';
import { htmlToText } from '../src/html';
import { toLocalDateTime } from '../src/mappers';
import { paginate, Smoobu } from '../src/smoobu';
import { propertySchema, reservationSchema } from '../src/types';
import { apartment, booking, bookingsPage, guest } from './fixtures';
import { fakeFetch, json, makeClient } from './helpers';

describe('mappers', () => {
  it('converts Smoobu naive timestamps', () => {
    expect(toLocalDateTime('2026-11-17 10:20:27')).toBe('2026-11-17T10:20:27');
    expect(toLocalDateTime('garbage')).toBeNull();
    expect(toLocalDateTime(null)).toBeNull();
  });

  it('turns HTML into readable text', () => {
    expect(htmlToText('<p>Hello&nbsp;<b>Anna</b></p><p>Code: 12&#52;<br/>See you</p>')).toBe(
      'Hello Anna\nCode: 124\nSee you',
    );
  });
});

describe('Smoobu.messages', () => {
  it('maps reservation messages to the domain model', async () => {
    const f = fakeFetch(
      json({
        page_count: 1,
        page_size: 25,
        total_items: 2,
        page: 1,
        messages: [
          {
            id: 9,
            subject: '',
            message: 'Hello',
            htmlMessage: '',
            type: 1,
            createdAt: '2026-11-17 10:20:27',
          },
          {
            id: 10,
            subject: 'Re',
            message: '',
            htmlMessage: '<p>Hi!</p>',
            type: 2,
            createdAt: null,
          },
        ],
      }),
    );
    const page = await new Smoobu(makeClient(f)).messages.list(5);
    expect(page).toEqual({
      items: [
        {
          id: 9,
          reservationId: 5,
          direction: 'inbound',
          subject: null,
          text: 'Hello',
          html: null,
          sentAt: '2026-11-17T10:20:27',
        },
        {
          id: 10,
          reservationId: 5,
          direction: 'outbound',
          subject: 'Re',
          text: 'Hi!',
          html: '<p>Hi!</p>',
          sentAt: null,
        },
      ],
      page: 1,
      pageSize: 25,
      pageCount: 1,
      total: 2,
    });
  });

  it('handles inquiry threads without booking or apartment id', async () => {
    const f = fakeFetch(
      json({
        page_number: 1,
        page_size: 25,
        page_count: 1,
        total_threads: 1,
        unread_messages: 3,
        threads: [
          {
            booking: { id: null, guest_name: '' },
            apartment: { id: null, name: null },
            latest_message: {
              id: 1,
              subject: '',
              text_content: 'Is it free?',
              html_content: '',
              created_at: '2026-11-17 09:48:03',
            },
          },
        ],
      }),
    );
    const page = await new Smoobu(makeClient(f)).messages.listConversations({ propertyIds: [3] });
    expect(String(f.mock.calls[0]![0])).toContain('apartments%5B%5D=3');
    expect(page.items[0]).toEqual({
      reservationId: null,
      guestName: null,
      property: { id: null, name: null },
      lastMessage: { id: 1, subject: null, preview: 'Is it free?', sentAt: '2026-11-17T09:48:03' },
    });
    expect(page.unreadMessages).toBe(3);
  });

  it('routes internal notes to send-message-to-host', async () => {
    const f = fakeFetch(
      json({ status: 201, title: 'Resource created successfully', detail: '' }, 201),
    );
    await new Smoobu(makeClient(f)).messages.send({
      reservationId: 5,
      body: 'note',
      audience: 'internal',
    });
    expect(String(f.mock.calls[0]![0])).toMatch(/send-message-to-host$/);
    expect(f.mock.calls[0]![1]?.body).toBe('{"messageBody":"note","internal":true}');
  });

  it('sends to the guest by default', async () => {
    const f = fakeFetch(
      json({ status: 201, title: 'Resource created successfully', detail: '' }, 201),
    );
    await new Smoobu(makeClient(f)).messages.send({
      reservationId: 5,
      body: 'hello',
      subject: 'Welcome',
    });
    expect(String(f.mock.calls[0]![0])).toMatch(/send-message-to-guest$/);
    expect(f.mock.calls[0]![1]?.body).toBe('{"messageBody":"hello","subject":"Welcome"}');
  });
});

describe('Smoobu.properties', () => {
  it('maps apartment details, coercing numbers', async () => {
    const f = fakeFetch(json(apartment()));
    const p = await new Smoobu(makeClient(f)).properties.get(10);
    expect(p).toMatchObject({
      id: 10,
      name: 'Chalet Alpha',
      type: 'Holiday rental',
      location: { city: 'Leysin', latitude: 46.34, longitude: 7.01 },
      timeZone: 'Europe/Zurich',
      capacity: { maxGuests: 4, bedrooms: 2, beds: { double: 2, single: null } },
      amenities: ['Wifi', 'Fireplace'],
      priceRange: { min: 150, max: 320 },
    });
    expect(propertySchema.safeParse(p).success).toBe(true);
  });

  it('accepts the documented `equipments` spelling', async () => {
    const f = fakeFetch(json(apartment({ amenities: undefined, equipments: ['Sauna'] })));
    expect((await new Smoobu(makeClient(f)).properties.get(10)).amenities).toEqual(['Sauna']);
  });
});

describe('Smoobu.reservations', () => {
  it('maps bookings and translates filters to Smoobu parameter names', async () => {
    const f = fakeFetch(
      json(
        bookingsPage([
          booking(),
          booking({ id: 101, type: 'cancellation' }),
          booking({ id: 102, 'is-blocked-booking': true, 'guest-name': '' }),
        ]),
      ),
    );
    const page = await new Smoobu(makeClient(f)).reservations.list({
      propertyId: 10,
      stayFrom: '2026-12-01',
      createdFrom: '2026-10-01',
      includeCancelled: true,
      includeBlocked: false,
      pageSize: 50,
    });
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      apartmentId: '10',
      from: '2026-12-01',
      created_from: '2026-10-01',
      showCancellation: 'true',
      excludeBlocked: 'true',
      pageSize: '50',
    });
    expect(page.items.map((r) => r.status)).toEqual(['confirmed', 'cancelled', 'blocked']);
    const r = page.items[0]!;
    expect(r).toMatchObject({
      reference: 'HMABC123',
      property: { id: 10, name: 'Chalet Alpha' },
      channel: { typeId: 74, name: 'Airbnb' },
      stay: { nights: 7, checkInTime: '16:00', adults: 2, children: 1 },
      guest: { id: 77, name: 'Anna Muster', language: 'fr' },
      notes: { guest: null, assistant: 'Late arrival' },
      payment: { total: 1200, paid: true, prepaymentPaid: false, channelCommission: 150.5 },
      createdAt: '2026-10-18T20:27:00',
      modifiedAt: '2026-10-18T20:27:49',
    });
    expect(reservationSchema.safeParse(r).success).toBe(true);
    expect(page.items[2]!.guest.name).toBeNull();
  });

  it('rejects page sizes Smoobu would silently ignore', async () => {
    const f = fakeFetch();
    await expect(
      new Smoobu(makeClient(f)).reservations.list({ pageSize: 200 }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(f).not.toHaveBeenCalled();
  });

  it('paginates lazily', async () => {
    const f = fakeFetch(
      json(bookingsPage([booking({ id: 1 })], 1, 2)),
      json(bookingsPage([booking({ id: 2 })], 2, 2)),
    );
    const smoobu = new Smoobu(makeClient(f));
    const ids: number[] = [];
    for await (const r of paginate((page) => smoobu.reservations.list({ page }))) ids.push(r.id);
    expect(ids).toEqual([1, 2]);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('Smoobu.guests', () => {
  it('maps the guest record and its reservations', async () => {
    const f = fakeFetch(json(guest()));
    const g = await new Smoobu(makeClient(f)).guests.get(77);
    expect(g).toMatchObject({
      id: 77,
      companyName: null,
      emails: ['anna@example.com'],
      phones: ['+41 00 000 00 00'],
      address: null,
      notes: 'Prefers French',
      reservations: [{ id: 100 }],
    });
  });
});
