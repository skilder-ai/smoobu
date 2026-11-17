# Smoobu toolkit

| Package                                         | What it is                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| [`@skilder-ai/smoobu`](packages/smoobu)         | Typed Smoobu API client: HMAC auth, validated responses, clean domain model. |
| [`@skilder-ai/smoobu-mcp`](packages/smoobu-mcp) | MCP server built on the client: guest conversations for AI agents.           |

## Develop

Node 24 for development (`.nvmrc`); the packages support Node 22 and later (Node 20 is end-of-life). pnpm 10.

```sh
pnpm install
pnpm check      # typecheck, lint, format:check, test, build
```

- Tests and typecheck resolve workspace packages to their **sources**, through the
  `@skilder-ai/source` export condition, so no build is needed first. Published manifests drop
  that condition (`publishConfig.exports`).
- The MCP executable must never write to stdout (that is the protocol channel). ESLint allows only
  `console.error` and `console.warn`.
- Never commit credentials. For live tests, put them in a local `.env`, which git ignores.

## Release

Releases use [Changesets](https://github.com/changesets/changesets):

1. `pnpm changeset`: describe the change and choose the version bumps. Commit the generated
   `.changeset/*.md` with your PR.
2. On `main`, the **Release** workflow opens or updates a "Version Packages" PR.
3. Merging that PR publishes to npm using **trusted publishing** (GitHub OIDC). No npm token is
   stored, and provenance is attached automatically.

**Setting up a new package.** Configure trusted publishing on npmjs.com _before_ its first
release: package Settings → Trusted publishing → GitHub Actions, repository `skilder-ai/smoobu`,
workflow `release.yml`, environment empty, **Allow `npm publish`** ticked. For a package that does
not exist yet, npm creates a `0.0.0-stage` placeholder version; deprecate it after the first real
release. Do not publish from a laptop: those versions get no provenance, and CI then has nothing
left to publish, which leaves the trusted-publishing setup unvalidated.

## License

MIT
