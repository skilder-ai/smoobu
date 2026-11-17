import { describe, expect, it } from 'vitest';
import { htmlToText } from '../src/html';
import { toLocalDateTime } from '../src/mappers';
import { Smoobu } from '../src/smoobu';
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
