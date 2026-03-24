import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANG_ALIASES = { js:'nodejs',javascript:'nodejs',ts:'typescript',node:'nodejs',py:'python',sh:'bash',shell:'bash',zsh:'bash' };
const FORBIDDEN_TOOLS = new Set(['glob','Glob','grep','Grep','search_file_content','Find','find']);
const FORBIDDEN_FILE_RE = [/\.(test|spec)\.(js|ts|jsx|tsx|mjs|cjs)$/, /^(jest|vitest|mocha|ava|jasmine|tap)\.(config|setup)/, /\.(snap|stub|mock|fixture)\.(js|ts|json)$/];
const FORBIDDEN_PATH_RE = ['/__tests__/','/test/','/tests/','/fixtures/','/test-data/',"/__mocks__/"];
const DOC_BLOCK_RE = /\.(md|txt)$/;

function detectLang(src) {
  if (/^\s*(import |from |export |const |let |var |function |class |async |await |console\.|process\.)/.test(src)) return 'nodejs';
  if (/^\s*(import |def |print\(|class |if __name__)/.test(src)) return 'python';
  return 'bash';
}

function stripFooter(s) { return s ? s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd() : ''; }

function runExec(rawLang, code, cwd) {
  const lang = LANG_ALIASES[rawLang] || (rawLang || detectLang(code));
  const opts = { encoding: 'utf-8', timeout: 30000, ...(cwd && { cwd }) };
  const out = (r) => { const o = (r.stdout||'').trimEnd(), e = stripFooter(r.stderr||'').trimEnd(); return o && e ? o+'\n[stderr]\n'+e : o||e||'(no output)'; };
  if (lang === 'python') return out(spawnSync('python3',['-c',code],opts));
  const ext = lang === 'typescript' ? 'ts' : lang === 'bash' ? 'sh' : 'mjs';
  const tmp = join(tmpdir(),'gm-plugin-'+Date.now()+'.'+ext);
  const src = lang === 'bash' ? code : 'const __r=await(async()=>{\n'+code+'\n})();if(__r!==undefined){if(typeof __r==="object"){console.log(JSON.stringify(__r,null,2));}else{console.log(__r);}}';
  writeFileSync(tmp,src,'utf-8');
  const r = lang === 'bash' ? spawnSync('bash',[tmp],opts) : spawnSync('bun',['run',tmp],opts);
  try { unlinkSync(tmp); } catch(e) {}
  let result = out(r);
  if (lang !== 'bash') result = result.split(tmp).join('<script>');
  return result;
}

function safePrintf(s) {
  return "printf '%s' '" + String(s).replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"'\\\\''")+"'";
}

function runThorns(dir) {
  try {
    const r = spawnSync('bun',['x','mcp-thorns@latest'],{encoding:'utf-8',timeout:15000,cwd:dir});
    return r.killed ? '' : (r.stdout||'').trim();
  } catch(e) { return ''; }
}

function runSearch(query, dir) {
  try {
    const r = spawnSync('bun',['x','codebasesearch',query],{encoding:'utf-8',timeout:10000,cwd:dir});
    return (r.stdout||'').trim();
  } catch(e) { return ''; }
}

export async function GmPlugin({ directory }) {
  const agentMd = join(__dirname, '..', 'agents', 'gm.md');
  const prdFile = join(directory, '.prd');
  const injectedSessions = new Set();

  return {
    'experimental.chat.system.transform': async (input, output) => {
      try { const rules = readFileSync(agentMd,'utf-8'); if (rules) output.system.unshift(rules); } catch(e) {}
      try {
        if (existsSync(prdFile)) {
          const prd = readFileSync(prdFile,'utf-8').trim();
          if (prd) output.system.push('\nPENDING WORK (.prd):\n'+prd);
        }
      } catch(e) {}
    },

    'experimental.chat.messages.transform': async (input, output) => {
      const msgs = output.messages;
      const lastUserIdx = msgs ? msgs.findLastIndex(m => m.info && m.info.role === 'user') : -1;
      if (lastUserIdx === -1) return;
      const msg = msgs[lastUserIdx];
      const sessionID = msg.info && msg.info.sessionID;
      if (sessionID && injectedSessions.has(sessionID)) return;
      if (sessionID) injectedSessions.add(sessionID);
      const textPart = msg.parts && msg.parts.find(p => p.type === 'text' && p.text && p.text.trim());
      const prompt = textPart ? textPart.text.trim() : '';
      const parts = [];
      parts.push('Invoke the `gm` skill to begin. DO NOT use EnterPlanMode.');
      const thorns = runThorns(directory);
      if (thorns) parts.push('=== mcp-thorns ===\n'+thorns);
      if (prompt) { const s = runSearch(prompt, directory); if (s) parts.push('=== codebasesearch ===\n'+s); }
      const injection = '<system-reminder>\n'+parts.join('\n\n')+'\n</system-reminder>';
      if (textPart) textPart.text = injection + '\n' + textPart.text;
      else if (msg.parts) msg.parts.unshift({ type: 'text', text: injection });
    },

    'tool.execute.before': async (input, output) => {
      if (FORBIDDEN_TOOLS.has(input.tool)) {
        output.args = { ...output.args, command: safePrintf('Use the code-search skill for codebase exploration instead of '+input.tool+'. Describe what you need in plain language.') };
        return;
      }
      if (input.tool === 'write' || input.tool === 'Write') {
        const fp = (output.args && output.args.file_path) || '';
        const base = basename(fp).toLowerCase();
        const ext = extname(fp);
        const blocked = FORBIDDEN_FILE_RE.some(re => re.test(base)) || FORBIDDEN_PATH_RE.some(p => fp.includes(p))
          || (DOC_BLOCK_RE.test(ext) && !base.startsWith('claude') && !base.startsWith('readme') && !fp.includes('/skills/'));
        if (blocked) {
          output.args = { ...output.args, command: safePrintf('Cannot create test/doc files. Use .prd for task notes, CLAUDE.md for permanent notes.') };
          return;
        }
      }
      if (input.tool !== 'bash') return;
      const cmd = output.args && output.args.command;
      if (!cmd) return;
      const m = cmd.match(/^exec(?::(\S+))?\n([\s\S]+)$/);
      if (!m) return;
      const result = runExec(m[1]||'', m[2], output.args.workdir || directory);
      output.args = { ...output.args, command: safePrintf('exec:'+(m[1]||'auto')+' output:\n\n'+result) };
    }
  };
}
