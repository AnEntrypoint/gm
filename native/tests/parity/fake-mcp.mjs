import { createInterface } from 'node:readline';

process.stderr.write('fake boot\n');

const tool = (name, description) => ({ name, description, inputSchema: { type: 'object', properties: {} } });
const firstPage = [
  tool('echo', 'E'.repeat(340)),
  tool('browsers', 'List browsers.'),
  tool('fail', 'Always fails.'),
  tool('hang', 'Never answers.'),
  tool('crash', 'Exits with code 3.'),
  tool('hidden', 'Denied by the entry.'),
];

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === undefined || message.id === undefined) return;
  const reply = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
  if (message.method === 'initialize') return reply({ protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'fake', version: '1' } });
  if (message.method === 'tools/list') {
    if (message.params?.cursor) return reply({ tools: [tool('extra', 'A tool on the second page.')] });
    return reply({ tools: firstPage, nextCursor: 'page2' });
  }
  if (message.method !== 'tools/call') return process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `fake does not serve ${message.method}` } })}\n`);
  const name = message.params?.name;
  if (name === 'hang') return;
  if (name === 'crash') process.exit(3);
  if (name === 'fail') return reply({ content: [{ type: 'text', text: 'boom' }], isError: true });
  if (name === 'echo') return reply({ content: [{ type: 'text', text: JSON.stringify(message.params.arguments ?? null) }], structuredContent: { echoed: message.params.arguments ?? null } });
  if (name === 'browsers') return reply({ content: [{ type: 'text', text: '[]' }, { type: 'image', mimeType: 'image/png', data: 'AA==' }] });
  return reply({ content: [{ type: 'text', text: 'extra' }] });
});
