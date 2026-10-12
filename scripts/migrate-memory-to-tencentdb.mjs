#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ARCHIVE = args.includes("--archive");
const projectIdx = args.indexOf("--project");
const PROJECT = projectIdx >= 0 ? args[projectIdx + 1] : process.cwd();
const nsIdx = args.indexOf("--namespace");
const NAMESPACE = nsIdx >= 0 ? args[nsIdx + 1] : "default";

const SPOOL_IN = join(PROJECT, ".gm", "exec-spool", "in");
const SPOOL_OUT = join(PROJECT, ".gm", "exec-spool", "out");
const MEMORIES_DIR = join(PROJECT, ".gm", "memories");
const RS_LEARN_DB = join(PROJECT, ".gm", "rs-learn.db");
const ARCHIVE_DIR = join(PROJECT, ".gm", "memories-archive-tencentdb", NAMESPACE);

function isDerivableStateMirroringMemorizeRs(text) {
  const trimmed = text.trim();
  if (trimmed.length > 40 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return "memo is a hex hash; git log is the source of truth";
  }
  const lower = trimmed.toLowerCase();
  const bad = [
    ["we used to ", "historical framing belongs in git log + CHANGELOG"],
    ["used to do", "historical framing belongs in git log + CHANGELOG"],
    ["previously did", "historical framing belongs in git log + CHANGELOG"],
    ["(fixed)", "past-tense fix markers belong in commit messages"],
    ["fixed in commit", "commit-fix references belong in git log"],
    ["fix in commit", "commit-fix references belong in git log"],
    ["changelog:", "changelog entries live in CHANGELOG.md"],
    ["changelog entry", "changelog entries live in CHANGELOG.md"],
    ["dated audit", "dated audit entries belong in git log"],
    ["(added 20", "dated annotations belong in git log"],
    ["commit hash", "commit hashes are derivable from git log"],
    ["recent commit", "recent commits are derivable from git log"],
    ["git blame says", "git blame is derivable from the repo"],
  ];
  for (const [pat, reason] of bad) {
    if (lower.includes(pat)) return reason;
  }
  return null;
}

function parseMemoryMdFrontmatterFile(raw) {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;
  const [, frontmatter, body] = frontmatterMatch;
  const fields = {};
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { key: fields.key, ns: fields.ns, created: fields.created, updated: fields.updated, text: body.trimEnd() };
}

function listMemoryFiles(namespace) {
  const dir = namespace === "default"
    ? MEMORIES_DIR
    : join(PROJECT, ".gm", "disciplines", namespace, "memories");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
}

function probeLegacyRsLearnDb() {
  if (!existsSync(RS_LEARN_DB)) return { present: false };
  const size = statSync(RS_LEARN_DB).size;
  return {
    present: true,
    sizeBytes: size,
    note: "not migrated -- retired sqlite/libsql format predating the .gm/memories corpus, undocumented schema, no reader in the current codebase; rs-plugkit's own legacy_reaper.rs deletes it outright on its next reap pass",
  };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function spoolResponsePath(verb, requestId) {
  return join(SPOOL_OUT, `${verb}-${requestId}.json`);
}

function writeSpoolRequest(verb, requestId, body) {
  const inDir = join(SPOOL_IN, verb);
  const requestPath = join(inDir, `${requestId}.txt`);
  mkdirSync(inDir, { recursive: true });
  writeFileSync(`${requestPath}.tmp`, JSON.stringify(body));
  renameSync(`${requestPath}.tmp`, requestPath);
}

function tryReadSpoolResponse(outPath) {
  if (!existsSync(outPath)) return undefined;
  try {
    return JSON.parse(readFileSync(outPath, "utf8"));
  } catch {
    return undefined;
  }
}

function awaitSpoolResponse(outPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = tryReadSpoolResponse(outPath);
    if (response !== undefined) return response;
    sleepSync(200);
  }
  throw new Error(`dispatch timeout waiting for ${outPath}`);
}

export function dispatchVerb(verb, body, timeoutMs = 30_000) {
  const requestId = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  writeSpoolRequest(verb, requestId, body);
  return awaitSpoolResponse(spoolResponsePath(verb, requestId), timeoutMs);
}

function main() {
  console.log(`[migrate] project=${PROJECT} namespace=${NAMESPACE} dry-run=${DRY_RUN}`);

  const legacy = probeLegacyRsLearnDb();
  if (legacy.present) {
    console.log(`[migrate] legacy .gm/rs-learn.db found (${legacy.sizeBytes} bytes) -- ${legacy.note}`);
  }

  const files = listMemoryFiles(NAMESPACE);
  console.log(`[migrate] found ${files.length} memory files in namespace "${NAMESPACE}"`);

  let kept = 0;
  let discarded = 0;
  let errored = 0;
  let archived = 0;
  const discardedSamples = [];

  for (const path of files) {
    const raw = readFileSync(path, "utf8");
    const parsed = parseMemoryMdFrontmatterFile(raw);
    if (!parsed || !parsed.text) {
      errored++;
      console.log(`[migrate]   ERROR: ${path} does not match the expected memory_md.rs frontmatter format, skipping`);
      continue;
    }
    const reason = isDerivableStateMirroringMemorizeRs(parsed.text);
    if (reason) {
      discarded++;
      if (discardedSamples.length < 10) {
        discardedSamples.push({ key: parsed.key, reason, preview: parsed.text.slice(0, 80) });
      }
      continue;
    }
    if (DRY_RUN) {
      kept++;
      continue;
    }
    try {
      const resp = dispatchVerb("memorize", { text: parsed.text, namespace: NAMESPACE, kind: "l0" });
      if (!resp.ok) {
        errored++;
        console.log(`[migrate]   ERROR migrating ${parsed.key}: ${resp.error || JSON.stringify(resp)}`);
        continue;
      }
      kept++;
      if (ARCHIVE) {
        try {
          const dest = join(ARCHIVE_DIR, basename(path));
          mkdirSync(dirname(dest), { recursive: true });
          renameSync(path, dest);
          archived++;
        } catch (e) {
          console.log(`[migrate]   WARN: migrated ${parsed.key} but failed to archive source ${path}: ${e.message}`);
        }
      }
    } catch (e) {
      errored++;
      console.log(`[migrate]   ERROR migrating ${parsed.key}: ${e.message}`);
    }
  }

  console.log(`[migrate] summary: kept=${kept} discarded=${discarded} errored=${errored} archived=${archived} total=${files.length}`);
  if (discardedSamples.length) {
    console.log(`[migrate] sample of discarded entries (up to 10):`);
    for (const s of discardedSamples) {
      console.log(`[migrate]   ${s.key}: ${s.reason} -- "${s.preview}${s.preview.length === 80 ? "..." : ""}"`);
    }
  }
  if (DRY_RUN) {
    console.log(`[migrate] dry-run: no writes performed. Re-run without --dry-run to migrate ${kept} memories.`);
  }
}

const isEntrypoint = resolve(process.argv[1] ?? "").toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isEntrypoint) main();
