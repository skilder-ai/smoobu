import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources (no build needed for tests).
export default defineConfig({
  resolve: { conditions: ['@skilder-ai/source'] },
  ssr: { resolve: { conditions: ['@skilder-ai/source'] } },
});
