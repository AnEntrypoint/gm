function selectIdleBrowserSessions(ports, now, limitMs) {
  const idle = [];
  if (!ports || typeof ports !== 'object') return idle;
  for (const [sid, entry] of Object.entries(ports)) {
    if (!entry || typeof entry !== 'object') continue;
    const lastUse = Number.isFinite(entry.lastUse) ? entry.lastUse : 0;
    const idleMs = now - lastUse;
    if (idleMs >= limitMs) idle.push({ sid, entry, idleMs });
  }
  return idle;
}

module.exports = { selectIdleBrowserSessions };
