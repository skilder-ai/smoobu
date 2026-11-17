# AGENTS.md

pnpm monorepo publishing two npm packages under `@skilder-ai`:

- `packages/smoobu`: Smoobu API client. The layers are `auth.ts` (HMAC) → `client.ts` (one method
  per endpoint, raw `wire.ts` types, retries and errors) → `mappers.ts` → `smoobu.ts` (the domain
  facade, using `types.ts`).
- `packages/smoobu-mcp`: MCP server. `server.ts` holds `createServer()` and the tools;
  `index.ts` is the stdio executable.

Rules:

- Add an endpoint in this order: a wire schema (lenient `looseObject`), a client method, a mapper
  and domain type, a facade method, then the MCP tool. Add tests with a fake `fetch`, never the
  real API.
- Tools: prefix names with `smoobu_`. Set the read-only, destructive and open-world annotations,
  define an `outputSchema`, keep outputs compact, and return errors through `errorResult` (which
  redacts credentials).
- Never write to stdout in `smoobu-mcp`. Never log or echo credentials.
- Every user-facing change needs a changeset (`pnpm changeset`).
- Definition of done: `pnpm check` passes.
