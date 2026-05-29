const assert = require('assert');
const { selectIdleBrowserSessions } = require('./browser-idle.js');

const NOW = 1_000_000;
const LIMIT = 10 * 60 * 1000;

(function onlyPastLimitSelected() {
  const ports = {
    active: { pid: 1, lastUse: NOW - 1000 },
    idle: { pid: 2, lastUse: NOW - (LIMIT + 5000) },
  };
  const idle = selectIdleBrowserSessions(ports, NOW, LIMIT);
  assert.strictEqual(idle.length, 1, 'exactly one idle session selected');
  assert.strictEqual(idle[0].sid, 'idle', 'the idle session is selected, active untouched');
})();

(function boundaryIsInclusive() {
  const ports = { edge: { pid: 1, lastUse: NOW - LIMIT } };
  const idle = selectIdleBrowserSessions(ports, NOW, LIMIT);
  assert.strictEqual(idle.length, 1, 'idleMs == limit closes (>=)');
})();

(function missingLastUseReapedAsStale() {
  const ports = { orphan: { pid: 1 } };
  const idle = selectIdleBrowserSessions(ports, NOW, LIMIT);
  assert.strictEqual(idle.length, 1, 'entry with no lastUse is treated as stale (epoch 0) and reaped');
  assert.strictEqual(idle[0].sid, 'orphan');
})();

(function concurrentIsolation() {
  const ports = {
    sessA: { pid: 1, lastUse: NOW - 2000 },
    sessB: { pid: 2, lastUse: NOW - (LIMIT + 1) },
    sessC: { pid: 3, lastUse: NOW - (LIMIT + 999999) },
  };
  const idle = selectIdleBrowserSessions(ports, NOW, LIMIT).map(x => x.sid).sort();
  assert.deepStrictEqual(idle, ['sessB', 'sessC'], 'only the idle sessions, active sessA preserved');
})();

(function emptyAndMalformed() {
  assert.deepStrictEqual(selectIdleBrowserSessions({}, NOW, LIMIT), [], 'empty ports');
  assert.deepStrictEqual(selectIdleBrowserSessions(null, NOW, LIMIT), [], 'null ports');
  assert.deepStrictEqual(selectIdleBrowserSessions({ bad: null, str: 'x' }, NOW, LIMIT), [], 'malformed entries skipped');
})();

console.log('browser-idle.test.js: all assertions passed');
