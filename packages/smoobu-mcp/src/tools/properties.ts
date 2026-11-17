import { propertySchema, type Property, type Smoobu } from '@skilder-ai/smoobu';
import { z } from 'zod';
import type { ToolContext } from './context';

const DEFAULT_TTL_MS = 10 * 60_000;
const CONCURRENCY = 5;

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping the input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Properties change rarely and listing them with details costs one call per property, so they
 * are cached in memory. Failed loads are not cached.
 */
export class PropertyDirectory {
  private all?: { at: number; value: Promise<Property[]> };
  private readonly byId = new Map<number, { at: number; value: Promise<Property> }>();

  constructor(
    private readonly smoobu: Smoobu,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Promise<Property[]> {
    if (!this.all || this.now() - this.all.at > this.ttlMs) {
      const value = this.smoobu.properties
        .list()
        .then((items) => mapLimit(items, CONCURRENCY, (p) => this.get(p.id)));
      this.all = { at: this.now(), value };
      value.catch(() => {
        if (this.all?.value === value) this.all = undefined;
      });
    }
    return this.all.value;
  }

  get(propertyId: number): Promise<Property> {
    const hit = this.byId.get(propertyId);
    if (hit && this.now() - hit.at <= this.ttlMs) return hit.value;
    const value = this.smoobu.properties.get(propertyId);
    this.byId.set(propertyId, { at: this.now(), value });
    value.catch(() => {
      if (this.byId.get(propertyId)?.value === value) this.byId.delete(propertyId);
    });
    return value;
  }
}

const propertyLineSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  type: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  timeZone: z.string().nullable(),
  maxGuests: z.number().nullable(),
  bedrooms: z.number().nullable(),
  bathrooms: z.number().nullable(),
  currency: z.string().nullable(),
});

export function registerPropertyTools({ server, run, properties }: ToolContext) {
  server.registerTool(
    'smoobu_list_properties',
    {
      title: 'List properties',
      description:
        'Lists every rental property (Smoobu "apartment") with its city, capacity, time zone and currency. Use the id with smoobu_get_property for the full details, or to filter reservations and conversations.',
      inputSchema: {},
      outputSchema: { items: z.array(propertyLineSchema), total: z.number() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async () => {
      const all = await properties.list();
      const items = all.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        city: p.location.city,
        country: p.location.country,
        timeZone: p.timeZone,
        maxGuests: p.capacity.maxGuests,
        bedrooms: p.capacity.bedrooms,
        bathrooms: p.capacity.bathrooms,
        currency: p.currency,
      }));
      return { items, total: items.length };
    }),
  );

  server.registerTool(
    'smoobu_get_property',
    {
      title: 'Get property details',
      description:
        'Returns one property: address and coordinates, time zone, capacity and beds, amenities, currency and nightly price range.',
      inputSchema: {
        propertyId: z.number().int().positive().describe('Smoobu property (apartment) id.'),
      },
      outputSchema: propertySchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(({ propertyId }) => properties.get(propertyId)),
  );
}
