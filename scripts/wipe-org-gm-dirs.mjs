#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORG = "AnEntrypoint";
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_SELF = "gm";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "pipe", windowsHide: true, ...opts });
}

function gh(args) {
  return run("gh", args, { encoding: "utf8" });
}

function listActiveRepos() {
  const out = gh(["repo", "list", ORG, "--limit", "500", "--json", "name,isArchived,defaultBranchRef"]);
  const repos = JSON.parse(out);
  if (!Array.isArray(repos)) throw new Error(`gh repo list did not return an array: ${out.slice(0, 200)}`);
  return repos.filter(repo => repo && typeof repo.name === "string" && !repo.isArchived && repo.name !== SKIP_SELF);
}

function cloneShallow(repo, dir) {
  run("git", ["clone", "--depth", "1", "--filter=blob:none", `https://github.com/${ORG}/${repo}.git`, dir], { timeout: 300_000 });
}

function hasGmDir(dir) {
  return existsSync(join(dir, ".gm"));
}

function wipeAndPush(repo, dir) {
  run("git", ["rm", "-rf", "--quiet", ".gm"], { cwd: dir });
  run("git", ["commit", "-m", "chore: remove vendored .gm/ state (org-wide gm cleanup)"], { cwd: dir });
  if (!DRY_RUN) {
    run("git", ["push", "origin", "HEAD"], { cwd: dir });
  }
}

function main() {
  const repos = listActiveRepos();
  const results = [];
  for (const repo of repos) {
    const dir = mkdtempSync(join(tmpdir(), `gm-wipe-${repo.name}-`));
    try {
      cloneShallow(repo.name, dir);
      if (!hasGmDir(dir)) {
        results.push({ repo: repo.name, action: "skipped-no-gm-dir" });
        continue;
      }
      wipeAndPush(repo.name, dir);
      results.push({ repo: repo.name, action: DRY_RUN ? "would-wipe" : "wiped" });
    } catch (e) {
      results.push({ repo: repo.name, action: "error", detail: String(e.message || e).slice(0, 300) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const summary = {
    total_repos_scanned: repos.length,
    wiped: results.filter(result => result.action === "wiped" || result.action === "would-wipe").length,
    skipped: results.filter(result => result.action === "skipped-no-gm-dir").length,
    errors: results.filter(result => result.action === "error"),
  };
  console.log(JSON.stringify({ summary, results }, null, 2));
}

main();
