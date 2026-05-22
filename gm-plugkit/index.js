#!/usr/bin/env node
'use strict';

const { ensureReady, startSpoolDaemon, getBinaryPath, isReady, bootstrap } = require('./bootstrap');

module.exports = {
  ensureReady,
  startSpoolDaemon,
  getBinaryPath,
  isReady,
  bootstrap,
};
