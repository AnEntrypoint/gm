import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const INSTALL_HINT = 'Run the remove and install commands that setup.sh prints.';

export function claudeConfigFile(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR ?? homedir(), '.claude.json');
}

export function registrationStatus(file = claudeConfigFile()) {
  if (!existsSync(file)) return { ok: true, text: `gm user entry: no ${file}, so none is registered` };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, text: `gm user entry: ${file} is not readable JSON (${err.message})` };
  }
  const entry = config?.mcpServers?.gm;
  if (entry === undefined) return { ok: true, text: `gm user entry: none in ${file}` };
  const relay = entry?.args?.[0];
  if (typeof relay === 'string' && existsSync(relay)) return { ok: true, text: `gm user entry runs ${relay}` };
  return { ok: false, text: `gm user entry in ${file} runs ${relay ?? 'nothing'}, which does not exist. ${INSTALL_HINT}` };
}
