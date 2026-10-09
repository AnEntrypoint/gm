#!/usr/bin/env node
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
  const rawReleases = await res.json();
  const releases = rawReleases.map((release) => ({
    tag: release.tag_name,
    name: release.name || release.tag_name,
    date: release.published_at || release.created_at,
    url: release.html_url
  }));
  return { releases, timestamp: new Date().toISOString() };
}

async function fetchNpmDownloadsForPackage(pkg) {
  const res = await fetch(`https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(pkg)}`);
  if (!res.ok) throw new Error(`npm downloads fetch failed for ${pkg}: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.downloads || []).map((dailyRow) => ({ date: dailyRow.day, count: dailyRow.downloads }));
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

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const WEEKS = 8;
const REVIEW_SAMPLE = 30;
const COMMIT_SAMPLE = 50;
const PAGE_SIZE = 100;

async function githubJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GitHub fetch failed for ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function githubPages(url, maxPages = 10) {
  const separator = url.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await githubJson(`${url}${separator}per_page=${PAGE_SIZE}&page=${page}`);
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return items;
}

function startOfIsoWeek(date) {
  const day = date.getUTCDay() || 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
}

function formatDuration(ms) {
  const hours = ms / (60 * 60 * 1000);
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}

async function fetchGithubStats() {
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
  const searchQuery = encodeURIComponent(`repo:${REPO} type:issue state:open`);

  const [openIssues, recentCommits, contributors, closedPulls] = await Promise.all([
    githubJson(`https://api.github.com/search/issues?q=${searchQuery}&per_page=1`),
    githubPages(`https://api.github.com/repos/${REPO}/commits?since=${windowStart}`, 3),
    githubPages(`https://api.github.com/repos/${REPO}/contributors`),
    githubPages(`https://api.github.com/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc`, 3)
  ]);

  const timestamp = new Date(now).toISOString();
  const commitTime = (commit) => Date.parse(commit.commit.author.date);
  const commitsPerWeek = recentCommits.filter((commit) => commitTime(commit) >= now - 7 * DAY_MS).length;

  const mergedPulls = closedPulls.filter((pull) => pull.merged_at);
  const mergeDurations = mergedPulls
    .filter((pull) => Date.parse(pull.merged_at) >= now - WINDOW_DAYS * DAY_MS)
    .map((pull) => Date.parse(pull.merged_at) - Date.parse(pull.created_at));
  const avgMergeMs = mergeDurations.length
    ? mergeDurations.reduce((sum, ms) => sum + ms, 0) / mergeDurations.length
    : null;

  const metrics = {
    open_issues: openIssues.total_count,
    commits_per_week: commitsPerWeek,
    contributors: contributors.length,
    avg_merge_time: avgMergeMs === null ? null : formatDuration(avgMergeMs),
    window_days: WINDOW_DAYS,
    timestamp
  };

  const reviewSample = [...mergedPulls]
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
    .slice(0, REVIEW_SAMPLE);
  const reviewBatches = await Promise.all(
    reviewSample.map((pull) => githubPages(`https://api.github.com/repos/${REPO}/pulls/${pull.number}/reviews`, 2))
  );
  const reviewCounts = {};
  for (const reviews of reviewBatches) {
    for (const review of reviews) {
      if (review.user) reviewCounts[review.user.login] = (reviewCounts[review.user.login] || 0) + 1;
    }
  }
  const topReviewers = Object.entries(reviewCounts)
    .map(([login, reviews]) => ({ login, reviews }))
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, 10);

  const commitSample = recentCommits.slice(0, COMMIT_SAMPLE);
  const commitDetails = await Promise.all(
    commitSample.map((commit) => githubJson(`https://api.github.com/repos/${REPO}/commits/${commit.sha}`))
  );
  const fileCounts = {};
  for (const detail of commitDetails) {
    for (const file of detail.files || []) fileCounts[file.filename] = (fileCounts[file.filename] || 0) + 1;
  }
  const topFiles = Object.entries(fileCounts)
    .map(([filePath, changes]) => ({ path: filePath, changes }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 10);

  const thisWeek = startOfIsoWeek(new Date(now));
  const velocity = [];
  for (let i = 0; i < WEEKS; i++) {
    const weekStart = new Date(thisWeek.getTime() - i * 7 * DAY_MS);
    const merged = mergedPulls.filter((pull) => startOfIsoWeek(new Date(pull.merged_at)).getTime() === weekStart.getTime()).length;
    velocity.push({ week: weekStart.toISOString().slice(0, 10), merged });
  }

  const insights = {
    generated: timestamp,
    window_days: WINDOW_DAYS,
    sampled: { pulls: closedPulls.length, reviewed_pulls: reviewSample.length, commits: commitSample.length },
    top_reviewers: topReviewers,
    top_files: topFiles,
    velocity
  };

  return { metrics, insights };
}

async function main() {
  await mkdir(apiDir, { recursive: true });

  const results = await Promise.allSettled([fetchReleases(), fetchNpmDownloads(), fetchGithubStats()]);

  const [releasesResult, npmResult, statsResult] = results;

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

  if (statsResult.status === 'fulfilled') {
    await writeFile(path.join(apiDir, 'metrics.json'), JSON.stringify(statsResult.value.metrics, null, 2) + '\n');
    await writeFile(path.join(apiDir, 'insights.json'), JSON.stringify(statsResult.value.insights, null, 2) + '\n');
    console.log('wrote docs/api/metrics.json and docs/api/insights.json');
  } else {
    console.error('metrics.json / insights.json generation failed:', statsResult.reason.message);
  }

}

main();
