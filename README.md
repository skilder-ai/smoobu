# Smoobu toolkit

| Package                                         | What it is                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| [`@skilder-ai/smoobu`](packages/smoobu)         | Typed Smoobu API client: HMAC auth, validated responses, clean domain model. |
| [`@skilder-ai/smoobu-mcp`](packages/smoobu-mcp) | MCP server built on the client: guest conversations for AI agents.           |

## Develop

Node 24 for development (`.nvmrc`); the packages support Node 20 and later. pnpm 10.

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

**First publish (one-off).** npm can only set up trusted publishing on packages that already
exist. A member of the `@skilder-ai` npm org therefore publishes 0.1.0 once from a clean checkout:

```sh
pnpm version-packages
npm login
NPM_CONFIG_PROVENANCE=false pnpm release
```

Then, on npmjs.com, open each package's Settings → Trusted publishing. Add GitHub Actions with
repository `skilder-ai/smoobu` and workflow `release.yml`. Every later release goes through CI.

## License

MIT
