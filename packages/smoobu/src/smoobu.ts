import { SmoobuClient, type SmoobuClientOptions } from './client';
import { toConversationSummary, toMessage } from './mappers';
import type { Account, ConversationPage, MessagePage, SendMessageInput } from './types';

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
