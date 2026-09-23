#!/usr/bin/env node
// Generates docs/api/releases.json and docs/api/npm-downloads.json at build time
// (gh-pages.yml runs this before copying docs/api/*.json into dist). Neither file
// is committed to git -- both are produced fresh on every deploy from live sources
// (GitHub Releases API, npm downloads-counts API), the same way docs/stats.html
// already expects the shape it reads.
//
// docs/api/metrics.json and docs/api/insights.json are NOT generated here: no
// data source for open_issues/commits_per_week/contributors/avg_merge_time or
// top_reviewers/top_files/velocity has been designed yet (tracked separately in
// .gm/prd.yml). docs/stats.html shows a visible "data unavailable" state for
// those two sections instead of fetching a file that does not exist.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiDir = path.join(repoRoot, 'docs', 'api');

const REPO = 'AnEntrypoint/gm';
const NPM_PACKAGES = ['gm-skill'];

function githubHeaders() {
  const headers = { 'User-Agent': 'gm-stats-dashboard', Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchReleases() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
    headers: githubHeaders()
  });
  if (!res.ok) throw new Error(`GitHub releases fetch failed: ${res.status} ${res.statusText}`);
  const raw = await res.json();
  const releases = raw.map((r) => ({
    tag: r.tag_name,
    name: r.name || r.tag_name,
    date: r.published_at || r.created_at,
    url: r.html_url
  }));
  return { releases, timestamp: new Date().toISOString() };
}

async function fetchNpmDownloadsForPackage(pkg) {
  const res = await fetch(`https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(pkg)}`);
  if (!res.ok) throw new Error(`npm downloads fetch failed for ${pkg}: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.downloads || []).map((d) => ({ date: d.day, count: d.downloads }));
}

async function fetchNpmDownloads() {
  const packages = {};
  for (const pkg of NPM_PACKAGES) {
    packages[pkg] = await fetchNpmDownloadsForPackage(pkg);
  }
  const byDate = {};
  for (const rows of Object.values(packages)) {
    for (const row of rows) byDate[row.date] = (byDate[row.date] || 0) + row.count;
  }
  const totals = Object.keys(byDate)
    .sort()
    .map((date) => ({ date, count: byDate[date] }));
  const last30 = totals.slice(-30);
  const total_30d = last30.reduce((sum, row) => sum + row.count, 0);
  return { packages, totals, total_30d, timestamp: new Date().toISOString() };
}

async function main() {
  await mkdir(apiDir, { recursive: true });

  const results = await Promise.allSettled([fetchReleases(), fetchNpmDownloads()]);

  const [releasesResult, npmResult] = results;

  if (releasesResult.status === 'fulfilled') {
    await writeFile(path.join(apiDir, 'releases.json'), JSON.stringify(releasesResult.value, null, 2) + '\n');
    console.log('wrote docs/api/releases.json');
  } else {
    console.error('releases.json generation failed:', releasesResult.reason.message);
  }

  if (npmResult.status === 'fulfilled') {
    await writeFile(path.join(apiDir, 'npm-downloads.json'), JSON.stringify(npmResult.value, null, 2) + '\n');
    console.log('wrote docs/api/npm-downloads.json');
  } else {
    console.error('npm-downloads.json generation failed:', npmResult.reason.message);
  }

  // Never fail the build over this: docs/stats.html shows a visible
  // "data unavailable" state for whichever file this run could not produce.
}

main();
