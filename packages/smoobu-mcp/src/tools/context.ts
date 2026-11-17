import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  propertySummarySchema,
  reservationStatusSchema,
  type Reservation,
  type Smoobu,
} from '@skilder-ai/smoobu';
import { z } from 'zod';
import type { PropertyDirectory } from './properties';

/** Wraps a handler: structured + text output, typed errors, redaction. */
export type Runner = <A, R extends Record<string, unknown>>(
  fn: (args: A) => Promise<R>,
) => (args: A) => Promise<CallToolResult>;

export interface ToolContext {
  server: McpServer;
  smoobu: Smoobu;
  run: Runner;
  properties: PropertyDirectory;
  allowWrites: boolean;
}

export const PII_HINT =
  'Guest names and message bodies are empty: the Smoobu API key most likely lacks the "Guest Data (PII)" permission (Smoobu → Settings → Advanced → API Keys).';

export const isoDateArg = z.iso.date().describe('YYYY-MM-DD');

/** A compact reservation line, for lists and conversation headers. */
export const reservationRowSchema = z.object({
  reservationId: z.number(),
  status: reservationStatusSchema,
  property: propertySummarySchema.nullable(),
  arrival: z.string(),
  departure: z.string(),
  nights: z.number().nullable(),
  guestName: z.string().nullable(),
  adults: z.number().nullable(),
  children: z.number().nullable(),
  channel: z.string().nullable(),
  /** Guest locale (reply in this language). */
  language: z.string().nullable(),
});
export type ReservationRow = z.infer<typeof reservationRowSchema>;

export function toRow(r: Reservation): ReservationRow {
  return {
    reservationId: r.id,
    status: r.status,
    property: r.property,
    arrival: r.stay.arrival,
    departure: r.stay.departure,
    nights: r.stay.nights,
    guestName: r.guest.name,
    adults: r.stay.adults,
    children: r.stay.children,
    channel: r.channel?.name ?? null,
    language: r.guest.language,
  };
}

/** True when there are guest bookings and none of them has a visible guest name. */
export const guestDataHidden = (rows: ReservationRow[]) => {
  const guests = rows.filter((r) => r.status !== 'blocked');
  return guests.length > 0 && guests.every((r) => !r.guestName);
};
