#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORG = "AnEntrypoint";
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_SELF = "gm";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function listActiveRepos() {
  const out = gh(["repo", "list", ORG, "--limit", "500", "--json", "name,isArchived,defaultBranchRef"]);
  const repos = JSON.parse(out);
  return repos.filter(r => !r.isArchived && r.name !== SKIP_SELF);
}

function cloneShallow(repo, dir) {
  execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", `https://github.com/${ORG}/${repo}.git`, dir], { stdio: "pipe", timeout: 300_000 });
}

function hasGmDir(dir) {
  return existsSync(join(dir, ".gm"));
}

function wipeAndPush(repo, dir) {
  execSync("git rm -rf --quiet .gm", { cwd: dir });
  execFileSync("git", ["commit", "-m", "chore: remove vendored .gm/ state (org-wide gm cleanup)"], { cwd: dir, stdio: "pipe" });
  if (!DRY_RUN) {
    execFileSync("git", ["push", "origin", "HEAD"], { cwd: dir, stdio: "pipe" });
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
    wiped: results.filter(r => r.action === "wiped" || r.action === "would-wipe").length,
    skipped: results.filter(r => r.action === "skipped-no-gm-dir").length,
    errors: results.filter(r => r.action === "error"),
  };
  console.log(JSON.stringify({ summary, results }, null, 2));
}

main();
