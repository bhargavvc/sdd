#!/usr/bin/env node

/**
 * @bhargavvc/sdd-cursor CLI — stdio MCP server entry point.
 *
 * Usage: sdd-cursor-mcp
 * Add to .cursor/mcp.json:
 *   { "mcpServers": { "sdd": { "command": "sdd-cursor-mcp" } } }
 */

import { createCursorMcpServer } from './server.js';

const MCP_PKG = '@modelcontextprotocol/sdk';

async function main(): Promise<void> {
  const server = await createCursorMcpServer();

  const { StdioServerTransport } = await import(`${MCP_PKG}/server/stdio.js`);
  const transport = new StdioServerTransport();

  let cleaningUp = false;
  async function cleanup(): Promise<void> {
    if (cleaningUp) return;
    cleaningUp = true;
    process.stderr.write('[sdd-cursor-mcp] Shutting down...\n');
    try { await server.close(); } catch { /* ignore */ }
    process.exit(0);
  }

  process.on('SIGTERM', () => void cleanup());
  process.on('SIGINT', () => void cleanup());
  process.stdin.on('end', () => void cleanup());

  try {
    await server.connect(transport);
    process.stderr.write('[sdd-cursor-mcp] MCP server started (22 tools, 35 prompts, 19 skills, zero Anthropic)\n');
  } catch (err) {
    process.stderr.write(`[sdd-cursor-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[sdd-cursor-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
