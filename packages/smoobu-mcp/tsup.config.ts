import { defineConfig } from 'tsup';

export default defineConfig({
  // index = the executable (stdio), server = the embeddable createServer() for other transports.
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  dts: { entry: 'src/server.ts' },
  sourcemap: true,
  clean: true,
});
