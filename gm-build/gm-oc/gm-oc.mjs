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

function runPlugkit(args) {
  const bin = join(__dirname, '..', 'bin', 'plugkit.js');
  if (!existsSync(bin)) return '';
  try {
    const r = spawnSync('node', [bin, ...args], { encoding: 'utf-8', timeout: 15000 });
    return (r.stdout || '').trim() || (r.stderr || '').trim();
  } catch(e) { return ''; }
}

function safePrintf(s) {
  return "printf '%s' '" + String(s).replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"'\\\\''")+"'";
}

function stripFooter(s) { return s ? s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd() : ''; }

function tryLangPlugin(lang, code, cwd) {
  const projectDir = cwd || process.cwd();
  const candidates = [join(projectDir, 'lang', lang+'.js'), join(__dirname, '..', 'lang', lang+'.js')];
  for (const langPluginFile of candidates) {
    if (!existsSync(langPluginFile)) continue;
    try {
      const plugin = require(langPluginFile);
      if (plugin && plugin.exec && plugin.exec.run) {
        const result = plugin.exec.run(code, projectDir);
        if (result && typeof result.then === 'function') continue;
        return String(result === undefined ? '' : result);
      }
    } catch(e) {}
  }
  return null;
}

function runExecSync(rawLang, code, cwd) {
  const lang = LANG_ALIASES[rawLang] || rawLang || 'nodejs';
  const opts = { encoding: 'utf-8', timeout: 30000, ...(cwd && { cwd }) };
  const out = (r) => { const o = (r.stdout||'').trimEnd(), e = stripFooter(r.stderr||'').trimEnd(); return o && e ? o+'\n[stderr]\n'+e : o||e||'(no output)'; };
  if (lang === 'codesearch' || lang === 'search') return runPlugkit(['search', '--path', cwd || process.cwd(), code.trim()]);
  if (lang === 'runner') return runPlugkit(['runner', code.trim()]);
  if (lang === 'status') return runPlugkit(['status', code.trim()]);
  if (lang === 'sleep') return runPlugkit(['sleep', code.trim()]);
  if (lang === 'close') return runPlugkit(['close', code.trim()]);
  if (lang === 'browser') return runPlugkit(['exec', '--lang', 'browser', '--code', code.trim(), '--cwd', cwd || process.cwd()]);
  if (lang === 'cmd') return out(spawnSync('cmd',['/c',code],opts));
  const pluginResult = tryLangPlugin(lang, code, cwd);
  if (pluginResult !== null) return pluginResult;
  if (lang === 'python') return out(spawnSync('python3',['-c',code],opts));
  if (lang === 'bash' || lang === 'sh') {
    const tmp = join(tmpdir(),'gm-exec-'+Date.now()+'.sh');
    writeFileSync(tmp,code,'utf-8');
    const r = spawnSync('bash',[tmp],opts);
    try { unlinkSync(tmp); } catch(e) {}
    return out(r);
  }
  const ext = lang === 'typescript' ? 'ts' : 'mjs';
  const tmp = join(tmpdir(),'gm-exec-'+Date.now()+'.'+ext);
  const src = lang === 'typescript' ? code : 'const __r=await(async()=>{\n'+code+'\n})();if(__r!==undefined){if(typeof __r==="object"){console.log(JSON.stringify(__r,null,2));}else{console.log(__r);}}';
  writeFileSync(tmp,src,'utf-8');
  const r = spawnSync('bun',['run',tmp],opts);
  try { unlinkSync(tmp); } catch(e) {}
  let result = out(r);
  if (result) result = result.split(tmp).join('<script>');
  return result;
}

const BANNED_BASH = ['grep','rg','find','glob','awk','sed','cat','head','tail'];
function bashBannedTool(code) {
  for (const t of BANNED_BASH) { if (new RegExp('(^|\\||;|&&|\\$\\()\\s*'+t+'(\\s|$)').test(code)) return t; }
  return null;
}

let sessionStarted = false;

export async function GmPlugin({ directory }) {
  const agentMd = join(__dirname, '..', 'agents', 'gm.md');
  const prdFile = join(directory, '.prd');
  const injectedSessions = new Set();

  return {
    'experimental.chat.system.transform': async (input, output) => {
      try {
        const giPath = join(directory, '.gitignore');
        const entry = '.gm-stop-verified';
        try {
          let content = existsSync(giPath) ? readFileSync(giPath,'utf-8') : '';
          if (!content.split('\n').some(l => l.trim() === entry)) {
            const nc = (content.endsWith('\n') || content === '') ? content + entry + '\n' : content + '\n' + entry + '\n';
            writeFileSync(giPath, nc, 'utf-8');
          }
        } catch(e) {}
      } catch(e) {}
      if (!sessionStarted) {
        sessionStarted = true;
        try { runPlugkit(['hook', 'session-start']); } catch(e) {}
        try { runPlugkit(['bootstrap', directory]); } catch(e) {}
      }
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
      const insight = runPlugkit(['codeinsight', directory]);
      if (insight && !insight.startsWith('Error')) parts.push('=== codeinsight ===\n'+insight);
      if (prompt) {
        const search = runPlugkit(['search', '--path', directory, prompt]);
        if (search && !search.startsWith('No results')) parts.push('=== search ===\n'+search);
      }
      const injection = '<system-reminder>\n'+parts.join('\n\n')+'\n</system-reminder>';
      if (textPart) textPart.text = injection + '\n' + textPart.text;
      else if (msg.parts) msg.parts.unshift({ type: 'text', text: injection });
    },

    'tool.execute.before': async (input, output) => {
      if (FORBIDDEN_TOOLS.has(input.tool)) {
        throw new Error('Use the code-search skill for codebase exploration instead of '+input.tool+'. Describe what you need in plain language.');
      }
      if (input.tool === 'EnterPlanMode') {
        throw new Error('Plan mode is disabled. Use the gm skill (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE state machine) instead.');
      }
      if (input.tool === 'Task' && input.args?.subagent_type === 'Explore') {
        throw new Error('The Explore agent is blocked. Use exec:codesearch in the Bash tool instead.\n\nexec:codesearch\n<natural language description of what to find>');
      }
      if (input.tool === 'Skill') {
        const skill = ((input.args && input.args.skill) || '').toLowerCase().replace(/^gm:/,'');
        if (skill === 'explore' || skill === 'search') {
          throw new Error('The search/explore skill is blocked. Use exec:codesearch instead.\n\nexec:codesearch\n<natural language description>');
        }
      }
      if (input.tool === 'write' || input.tool === 'Write' || input.tool === 'edit') {
        const fp = (output.args && output.args.file_path) || (input.args && input.args.file_path) || '';
        const base = basename(fp).toLowerCase();
        const ext = extname(fp);
        const blocked = FORBIDDEN_FILE_RE.some(re => re.test(base)) || FORBIDDEN_PATH_RE.some(p => fp.includes(p))
          || (DOC_BLOCK_RE.test(ext) && !base.startsWith('claude') && !base.startsWith('agents') && !base.startsWith('readme') && !fp.includes('/skills/'));
        if (blocked) {
          throw new Error('Cannot create test/doc files. Use .prd for task notes, AGENTS.md for permanent notes.');
        }
      }
      if (input.tool !== 'bash' && input.tool !== 'Bash') return;
      const cmd = (output.args && output.args.command) || '';
      if (!cmd) return;
      if (/^\s*git(?:\s|$)/.test(cmd)) return;
      const m = cmd.match(/^exec(?::(\S+))?\n([\s\S]+)$/);
      if (!m) {
        output.args.command = "echo 'Bash tool can only be used with exec syntax:\n\nexec[:lang]\n<command>\n\nExamples:\nexec\nls -la\n\nexec:nodejs\nconsole.log(\"hello\")' 1>&2 && false";
        return;
      }
      const rawLang = (m[1]||'').toLowerCase();
      if (rawLang === 'bash' || rawLang === 'sh' || rawLang === '') {
        const banned = bashBannedTool(m[2]);
        if (banned) throw new Error('`'+banned+'` is blocked in exec:bash. Use exec:codesearch instead.');
      }
      const result = runExecSync(m[1]||'', m[2], output.args.workdir || directory);
      output.args = { ...output.args, command: safePrintf('exec:'+(m[1]||'nodejs')+' output:\n\n'+result) };
    }
  };
}
