# @skilder-ai/smoobu

Typed TypeScript client for the [Smoobu API](https://docs.smoobu.com/).

- **HMAC request signing** (`X-API-Key`, `X-Timestamp`, `X-Nonce`, `X-Signature`), with a fresh
  nonce on every retry.
- **Validated responses** (zod). Smoobu's documentation and its real payloads differ, and the
  schemas accept the real ones.
- **Clean domain model**: `Message`, `ConversationSummary`, and one page envelope everywhere
  (`items/page/pageSize/pageCount/total`).
- **Robust transport**: timeouts, and retries on 429/5xx/network errors for GET requests only.
  Rate-limit waits follow Smoobu's reset time.
- **Typed errors**: `SmoobuApiError` carries `status`, `code`
  (`unauthorized | forbidden | not_found | validation | rate_limited | upstream | network`) and
  `retryable`.

Requires Node ≥ 22 and `zod` 4 (peer dependency).

```sh
npm install @skilder-ai/smoobu zod
```

```ts
import { Smoobu, SmoobuApiError } from '@skilder-ai/smoobu';

const smoobu = new Smoobu({
  apiKey: process.env.SMOOBU_API_KEY!,
  apiSecret: process.env.SMOOBU_API_SECRET!,
});

const account = await smoobu.getAccount();
const conversations = await smoobu.messages.listConversations({ pageSize: 20 });
const thread = await smoobu.messages.list(123456789);
await smoobu.messages.send({ reservationId: 123456789, body: 'Welcome!', audience: 'guest' });

try {
  await smoobu.messages.list(1);
} catch (err) {
  if (err instanceof SmoobuApiError && err.code === 'not_found') {
    /* … */
  }
}
```

For endpoints not wrapped yet, use the low-level client, `smoobu.client`. It has one method per
endpoint and returns raw `wire` types.

## Smoobu quirks handled

- Messages use `htmlMessage`, although the docs' example says `messageHtml`. Both are accepted.
- Messages carry an undocumented `createdAt` (`YYYY-MM-DD HH:MM:SS`, timezone not documented). It
  is exposed as an offset-less ISO local date-time.
- Threads can have `booking.id` and `apartment.id` set to `null` (inquiries without a booking).
- Pagination parameters differ per endpoint (`page` vs `page_number`, `page_size` vs `pageSize`).
  This package normalises them.
- Without the key's **"Guest Data (PII)"** permission, guest names and message bodies come back as
  empty strings.
- Sending returns no message id.
