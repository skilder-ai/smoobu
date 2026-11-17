#!/usr/bin/env node
/**
 * smoobu-mcp executable: MCP over stdio.
 * stdout carries the protocol — log to stderr only (console.error).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server';

try {
  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(
    `${SERVER_NAME} ${SERVER_VERSION} ready (stdio, writes ${config.allowWrites ? 'enabled' : 'disabled'})`,
  );

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (err) {
  console.error(`${SERVER_NAME}: ${err instanceof ConfigError ? err.message : String(err)}`);
  process.exit(1);
}
