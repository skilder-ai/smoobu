import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url));

// Runs against the built executable (pnpm build first); skipped otherwise.
describe.skipIf(!existsSync(bin))('executable', () => {
  it('exits 1 with a clear message and empty stdout when credentials are missing', () => {
    const res = spawnSync(process.execPath, [bin], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('Missing SMOOBU_API_KEY and SMOOBU_API_SECRET');
  });
});
