# @skilder-ai/smoobu-mcp

[MCP](https://modelcontextprotocol.io) server for [Smoobu](https://www.smoobu.com), the
vacation-rental channel manager. It lets an AI agent look up properties and reservations, read guest
conversations with their booking context and, if you allow it, send messages.

- Signs every request with Smoobu's HMAC scheme. Smoobu has retired the old key-only `Api-Key`
  authentication.
- Returns clean, compact results (`inbound`/`outbound`, ISO dates, plain text) with typed
  `structuredContent`.
- Gives actionable errors: `unauthorized`, `not_found`, `rate_limited`, and so on, each with a
  hint and a `retryable` flag.
- Read-only by default. Sending must be enabled explicitly.

## Quick start

```json
{
  "mcpServers": {
    "smoobu": {
      "command": "npx",
      "args": ["-y", "@skilder-ai/smoobu-mcp@0.2.0"],
      "env": {
        "SMOOBU_API_KEY": "…",
        "SMOOBU_API_SECRET": "…"
      }
    }
  }
}
```

Pin an exact version in production configs.

## Configuration

| Variable              | Required | Description                                                       |
| --------------------- | -------- | ----------------------------------------------------------------- |
| `SMOOBU_API_KEY`      | yes      | HMAC API key (Smoobu → Settings → Advanced → API Keys).           |
| `SMOOBU_API_SECRET`   | yes      | Its secret. Shown only once when the key is created.              |
| `SMOOBU_ALLOW_WRITES` | no       | `true` registers `smoobu_send_message`. Default: off (read-only). |
| `SMOOBU_BASE_URL`     | no       | Default `https://login.smoobu.com`.                               |

> **Enable "Guest Data (PII)" on the API key.** Without it, Smoobu returns guest names and message
> bodies as empty strings. `smoobu_check_connection` reports this as `guestDataVisible: false`.

The server refuses to start without both the key and the secret. It never prints them, and it
redacts them from error output.

## Tools

| Tool                        | Kind      | What it does                                                                                                                                                             |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `smoobu_check_connection`   | read      | Checks credentials. Returns the account, `guestDataVisible` and `writesEnabled`.                                                                                         |
| `smoobu_list_properties`    | read      | Every property with city, capacity, time zone and currency. Cached for 10 minutes.                                                                                       |
| `smoobu_get_property`       | read      | One property: address, coordinates, beds, amenities, price range.                                                                                                        |
| `smoobu_find_reservations`  | read      | Reservations by stay period, arrival/departure dates, property, status or `guestName`. Compact rows with guest name and language. Blocked dates are left out by default. |
| `smoobu_get_reservation`    | read      | One booking in full, plus its property (time zone) and the guest's CRM profile (notes, other stays). Email and phone only with `includeContact: true`.                   |
| `smoobu_list_conversations` | read      | Conversations by latest activity. Params: `page`, `pageSize` (≤100), `propertyIds`. Includes the unread count.                                                           |
| `smoobu_read_conversation`  | read      | A reservation header and its `latest` messages (default 20), oldest to newest. `olderPage` lets the agent page back.                                                     |
| `smoobu_list_messages`      | read      | Deprecated: use `smoobu_read_conversation`.                                                                                                                              |
| `smoobu_send_message`       | **write** | Only when `SMOOBU_ALLOW_WRITES=true`. Params: `reservationId`, `body`, `subject?`, `audience` (`guest` \| `internal`).                                                   |

Guest names, message bodies and guest records need the key's **"Guest Data (PII)"** permission.
Without it, tools still work but return empty guest fields together with a `hint`, and
`guestName` search fails with `forbidden`.

`audience: "guest"` reaches the guest through their booking channel and cannot be undone.
`audience: "internal"` adds a host-only note to the reservation.

## Embedding

The package also exports `createServer()`, so you can use another transport (for example
Streamable HTTP):

```ts
import { createServer } from '@skilder-ai/smoobu-mcp';

const server = createServer({ apiKey, apiSecret, allowWrites: false });
await server.connect(transport);
```

## Development

From the repository root, run `pnpm install && pnpm check`. To debug interactively:
`pnpm --filter @skilder-ai/smoobu-mcp inspect`, which opens the MCP Inspector.
