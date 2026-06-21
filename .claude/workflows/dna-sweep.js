export const meta = {
  name: 'dna-sweep',
  description: 'Fan out synthesized-engineering-DNA + context-engineering improvement sweep across gm and the rs-* repos; adversarially verify; classify implement-now vs defer-invasive',
  whenToUse: 'Run to surface and triage agentic-usefulness improvements across gm/rs-* using the 12-principle DNA lens plus context-rot/memory research; pass args.repos to scope, args.focus to bias the lens',
  phases: [
    { title: 'Sweep', detail: 'one agent per repo, DNA + context-engineering lens, returns candidate findings' },
    { title: 'Verify', detail: 'adversarial refute per finding; survives only on real file:line evidence' },
    { title: 'Classify', detail: 'bucket implement-now vs defer-invasive vs already-shipped against the known deferred-cluster constant' },
    { title: 'Synthesize', detail: 'merge into one verdict with implement-now list and defer prd-seeds' },
  ],
}

const REPOS = (args && Array.isArray(args.repos) && args.repos.length)
  ? args.repos
  : [
      { name: 'rs-plugkit', path: 'c:/dev/rs-plugkit', role: 'orchestrator + spool dispatch + gates + prose' },
      { name: 'rs-learn', path: 'c:/dev/rs-learn', role: 'learning pipeline + memory store + recall ranking' },
      { name: 'rs-codeinsight', path: 'c:/dev/rs-codeinsight', role: 'code indexer + digest freshness' },
      { name: 'rs-search', path: 'c:/dev/rs-search', role: 'vector search + RRF fusion' },
      { name: 'rs-exec', path: 'c:/dev/rs-exec', role: 'JS execution host + ABI' },
      { name: 'gm', path: 'c:/dev/gm', role: 'harness skill + spool client + bootstrap' },
    ]

const PRINCIPLES = [
  '1 Data First (complex code = wrong data model; make state explicit)',
  '2 Subtractive (every abstraction/dep/option is a liability; remove before adding)',
  '3 Evolutionary (ship simplest, iterate; revert regressions first)',
  '4 Composition Spine (minimal core, each layer +1 capability, power-of-one test)',
  '5 Physics-First (reason from latency/memory/bandwidth/clock constraints)',
  '6 Adversarial Design (make misuse syntactically impossible; honest defaults; assume failure)',
  '7 Empirical (measure dont assume; profile before optimizing; both-ways)',
  '8 Automated Correctness (guardrails over vigilance: types/lints/pure-fns; invalid states unrepresentable)',
  '9 Worst-Case Resilience (optimize worst case; explicit degradation; no silent catastrophic failure)',
  '10 Honest Interfaces (published contracts sacred; never claim un-guaranteed properties)',
  '11 Crucible (validate by exercising the hardest case first)',
  '12 Human Value (trace every decision to a human/agent outcome or it is aesthetics)',
].join('\n')

const CONTEXT_LENS = [
  'context-rot (trychroma): irrelevant/overlong context degrades retrieval and reasoning -- prefer snippet+expand over context-dump, trim payloads to phase need',
  'chatgpt-memory: write-time dedup, decay/recency weighting, salience scoring, access-frequency reinforcement, semantic consolidation -- a flat append-only memory rots',
  'RLM arxiv 2512.24601 (Recursive Language Models): treat long input as an external environment the model drills into recursively, not a single front-loaded dump',
].join('\n')

const DEFER_INVASIVE = [
  'context-rot orchestration-core payload trimming (recall full-text to snippet+expand, instruction prose phase-gating, drop null diagnostic blocks) -- changes the agent OWN input contract',
  'supervisor version-transition self-heal lifecycle (respawn-loop churn during cascade publish; multi-process race) -- unsafe without a multi-process test harness',
  'rs-learn memory-arch (write-time dedup, decay/recency weighting, salience scoring, access-freq reinforcement, semantic consolidation merge)',
  'fusion error-signal Searcher signature change',
  'camel-split single-char segment handling -- needs a measured search-quality eval first',
]

const ALREADY_SHIPPED = [
  'gm spool.js validateVerb/validateLang throw on unknown input (no silent coerce)',
  'gm spool-dispatch.js session-scoped instruction-seen check + line-aware yamlStatusValues PRD/mutable gate + paper-citation strip',
  'gm skill-bootstrap.js never verifies newer download vs manifest older-version hash + 3s pid-probe timeout',
  'gm ssh.js timeout-marks partial output; browser-spool-handler.js honest error; gm-validate.js repo-docs fixture; renderPlatformSkill deleted; code comments stripped + test.js checkNoComments',
  'rs-codeinsight project.rs top-level JSON field parser (object_body + top_level_fields) + walkdir dep removed + digest content-sensitivity + hex_encode',
  'rs-plugkit code_index.rs write_chunk + memorize_at_finalize use exec_params bound params (sql_quote eliminated on those INSERTs) + em-dash glyph sweep + git_porcelain fail->dirty + gates YAML fail-safe',
  'rs-plugkit kv_put namespace allowlist + fs_write path-traversal sandbox + forget host_kv_delete + close/feedback rc-inversion fix',
  'rs-learn LlmError qualification + route len-check + record_loss finiteness + per_target len + router trained-on-mismatch guard + host_kv_put rc-inversion fix',
  'rs-exec wasm_spool.rs error-channel stdout->stderr + timeout-ceiling + started/ended rename + batch-log + is_rejected stub removed + two-phase inbox parse',
  'rs-search RRF rrf_merge_n canonical N-source fusion (delegated, f64 1-indexed) + candidate-pool + test.js phantom-arch rewrite',
]

const FINDING_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['repo', 'file', 'line', 'principle', 'severity', 'jank_class', 'description', 'fix_sketch'],
        properties: {
          repo: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'string' },
          principle: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          jank_class: { type: 'string', enum: ['bug', 'immaturity', 'unfinished-edge', 'half-wired-path', 'missing-guardrail', 'dishonest-interface', 'profiling', 'security'] },
          description: { type: 'string' },
          fix_sketch: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['is_real', 'confidence', 'refutation'],
  properties: {
    is_real: { type: 'boolean' },
    confidence: { type: 'number' },
    refutation: { type: 'string' },
  },
}

const CLASS_SCHEMA = {
  type: 'object',
  required: ['bucket', 'rationale'],
  properties: {
    bucket: { type: 'string', enum: ['implement-now', 'defer-invasive', 'already-shipped'] },
    rationale: { type: 'string' },
  },
}

const LENS = `Operating discipline -- synthesized-engineering-DNA (12 principles, earlier wins conflicts):\n${PRINCIPLES}\n\nContext-engineering lens (apply to any memory/recall/context/payload surface):\n${CONTEXT_LENS}\n\nThis is a compound lens, not a checklist: hunt jank -- the rough, unfinished, half-wired, dishonest, and unguarded -- not only outright bugs.`

const focus = (args && args.focus) ? `\n\nBias this sweep toward: ${args.focus}` : ''

phase('Sweep')
const swept = await parallel(REPOS.map(r => () =>
  agent(
    `${LENS}${focus}\n\nSweep the ${r.name} repo at ${r.path} (role: ${r.role}). Read source by absolute path (this repo is a sibling, not the indexed cwd -- use Read/Glob on ${r.path}, do not expect codesearch to cover it). Enumerate every reachable improvement where the code violates a DNA principle or the context-engineering lens, or carries jank. For each, give repo,file,line (exact),principle,severity,jank_class,description,fix_sketch. Be exhaustive within this one repo; prefer concrete file:line evidence over speculation. Skip anything that is merely stylistic with no human/agent-outcome impact (Principle 12).`,
    { label: `sweep:${r.name}`, phase: 'Sweep', schema: FINDING_SCHEMA }
  )
))

const candidates = swept.filter(Boolean).flatMap(s => s.findings || [])
log(`dna-sweep: ${candidates.length} candidate findings across ${REPOS.length} repos`)

phase('Verify')
const verified = await pipeline(
  candidates,
  f => agent(
    `Adversarially REFUTE this finding. Read ${f.file} around line ${f.line} in the repo by absolute path and decide if the claimed defect is real at that exact location. Default to is_real=false unless the evidence is concrete. Finding: [${f.repo}] ${f.principle} / ${f.jank_class} / ${f.severity} -- ${f.description}. Fix sketch: ${f.fix_sketch}.`,
    { label: `verify:${f.repo}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  ).then(v => ({ ...f, verdict: v }))
)

const real = verified.filter(Boolean).filter(f => f.verdict && f.verdict.is_real)
log(`dna-sweep: ${real.length}/${candidates.length} findings survived adversarial verify`)

phase('Classify')
const deferText = DEFER_INVASIVE.map((d, i) => `${i + 1}. ${d}`).join('\n')
const shippedText = ALREADY_SHIPPED.map((d, i) => `${i + 1}. ${d}`).join('\n')
const classified = await parallel(real.map(f => () =>
  agent(
    `Classify this verified finding into one bucket.\n\nALREADY-SHIPPED in prior fires (if the finding matches or is the same fix as any below, bucket=already-shipped -- do NOT re-propose it; Read the current source to confirm the fix is present):\n${shippedText}\n\nKNOWN DEFER-INVASIVE clusters (invasive to load-bearing infra the agent depends on; need supervised work, NOT autonomous loop iteration):\n${deferText}\n\nIf the finding matches a shipped fix, bucket=already-shipped. If it matches/touches a defer cluster, bucket=defer-invasive. Else if it is isolated, real-services-witnessable, touches no published contract or multi-process concurrency or the agent own input contract, bucket=implement-now. Finding: [${f.repo}] ${f.file}:${f.line} -- ${f.description}. Fix: ${f.fix_sketch}.`,
    { label: `classify:${f.repo}`, phase: 'Classify', schema: CLASS_SCHEMA }
  ).then(c => ({ ...f, klass: c }))
))

phase('Synthesize')
const live = classified.filter(Boolean)
const implementNow = live.filter(f => f.klass && f.klass.bucket === 'implement-now')
const defer = live.filter(f => f.klass && f.klass.bucket === 'defer-invasive')
const shipped = live.filter(f => f.klass && f.klass.bucket === 'already-shipped')
log(`dna-sweep: ${implementNow.length} implement-now, ${defer.length} defer-invasive, ${shipped.length} already-shipped`)
return {
  candidates: candidates.length,
  verified: real.length,
  implement_now: implementNow.map(f => ({ repo: f.repo, file: f.file, line: f.line, severity: f.severity, principle: f.principle, description: f.description, fix_sketch: f.fix_sketch })),
  defer_invasive: defer.map(f => ({ repo: f.repo, file: f.file, line: f.line, description: f.description, rationale: f.klass.rationale })),
  already_shipped: shipped.map(f => ({ repo: f.repo, file: f.file, line: f.line, description: f.description })),
}
