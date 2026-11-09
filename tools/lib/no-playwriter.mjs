import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function withoutPlaywriter(workspace) {
  mkdirSync(join(workspace, '.gm'), { recursive: true });
  writeFileSync(join(workspace, '.gm', 'mcp.json'), JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  return workspace;
}
