import { htmlToText } from './html';
import type { ConversationSummary, Message } from './types';
import type { SmoobuMessage, SmoobuThread } from './wire';

/** "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"; anything unexpected → null. */
export function toLocalDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value.trim());
  return m ? `${m[1]}T${m[2]}` : null;
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
