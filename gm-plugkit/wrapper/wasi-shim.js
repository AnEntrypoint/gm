import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function wasiFilesystemRootFor(gmToolsRoot) {
  const projectSlug = crypto.createHash('sha256')
    .update(String(process.env.CLAUDE_PROJECT_DIR || process.cwd()).toLowerCase().replace(/\\/g, '/'))
    .digest('hex').slice(0, 16);
  return path.join(gmToolsRoot, 'wasi-fs', projectSlug);
}

function makeWasiResolvePath(wasiFilesystemRoot) {
  return function wasiResolvePath(relPath) {
    const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const resolved = path.resolve(wasiFilesystemRoot, rel);
    const rootResolved = path.resolve(wasiFilesystemRoot) + path.sep;
    if (resolved !== path.resolve(wasiFilesystemRoot) && !resolved.startsWith(rootResolved)) {
      throw new Error(`wasi-path-traversal-refused: ${relPath} escapes ${wasiFilesystemRoot}`);
    }
    return resolved;
  };
}

function createWasiShim(instanceRef, ctx) {
  const { wasiFilesystemRoot, wasiOpenFiles, wasiNextFdRef, wasmAbortFlag, spoolDirForSentinel, currentVerbContextRef } = ctx;
  const wasiResolvePath = makeWasiResolvePath(wasiFilesystemRoot);
  const getMemory = () => instanceRef.value.exports.memory.buffer;
  const shim = {
    proc_exit: (code) => {
      wasmAbortFlag.aborted = true;
      wasmAbortFlag.code = code;
      try {
        const spoolDir = spoolDirForSentinel();
        fs.mkdirSync(spoolDir, { recursive: true });
        fs.writeFileSync(path.join(spoolDir, '.wasm-abort.json'), JSON.stringify({
          ts: Date.now(),
          exit_code: code,
          verb_in_flight: currentVerbContextRef.value,
        }));
      } catch (_) {}
      try { console.error(`[plugkit-wasm] wasm proc_exit(${code}) intercepted; throwing to abort current verb without killing watcher`); } catch (_) {}
      throw new Error(`wasm proc_exit(${code}) during verb ${currentVerbContextRef.value && currentVerbContextRef.value.verb}`);
    },
    fd_write: (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
      try {
        const buf = getMemory();
        const dv = new DataView(buf);
        const chunks = [];
        let total = 0;
        const iovsBase = iovs_ptr >>> 0;   // >>>0: high-bit iovs pointer is negative in JS -> getUint32 would throw
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
          const ptr = dv.getUint32(base, true);
          const len = dv.getUint32(base + 4, true);
          if (len > 0 && ptr + len <= buf.byteLength) {
            chunks.push(new Uint8Array(buf, ptr, len).slice());
            total += len;
          }
        }
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        const text = new TextDecoder('utf-8').decode(merged);
        if (fd === 2) process.stderr.write(text);
        else process.stdout.write(text);
        new DataView(getMemory()).setUint32(nwritten_ptr, total, true);
        return 0;
      } catch (e) {
        return 28;
      }
    },
    random_get: (buf_ptr, buf_len) => {
      try {
        crypto.randomFillSync(new Uint8Array(getMemory(), buf_ptr >>> 0, buf_len >>> 0));   // >>>0: high-bit ptr is negative in JS
        return 0;
      } catch (e) {
        return 28;
      }
    },
    clock_time_get: (clock_id, precision, time_ptr) => {
      try {
        const ns = BigInt(Date.now()) * 1000000n;
        new DataView(getMemory()).setBigUint64(time_ptr >>> 0, ns, true);   // >>>0: high-bit ptr is negative in JS
        return 0;
      } catch (e) {
        return 28;
      }
    },
    environ_get: () => 0,
    environ_sizes_get: () => 0,
    fd_prestat_get: (fd, buf_ptr) => {
      if (fd !== 3) return 8;
      try {
        const dv = new DataView(getMemory());
        dv.setUint8(buf_ptr, 0);
        dv.setUint32(buf_ptr + 4, 1, true);
        return 0;
      } catch (e) { return 8; }
    },
    fd_prestat_dir_name: (fd, path_ptr, path_len) => {
      if (fd !== 3) return 8;
      try {
        const buf = getMemory();
        new Uint8Array(buf, path_ptr >>> 0, Math.min(path_len, 1)).set([0x2e]);
        return 0;
      } catch (e) { return 8; }
    },
    fd_close: (fd) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 0;
      try { fs.closeSync(entry.nodeFd); } catch (_) {}
      wasiOpenFiles.delete(fd);
      return 0;
    },
    fd_fdstat_get: (fd, stat_ptr) => {
      try {
        const dv = new DataView(getMemory());
        const entry = wasiOpenFiles.get(fd);
        dv.setUint8(stat_ptr, entry ? 4 : 0);
        dv.setUint8(stat_ptr + 1, 0);
        dv.setBigUint64(stat_ptr + 8, 0xffffffffffffffffn, true);
        dv.setBigUint64(stat_ptr + 16, 0xffffffffffffffffn, true);
        return 0;
      } catch (e) { return 8; }
    },
    fd_fdstat_set_flags: () => 0,
    fd_filestat_get: (fd, buf_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_filestat_get FAILED: no entry for fd=${fd}`); return 8; }
      try {
        const st = fs.fstatSync(entry.nodeFd);
        const dv = new DataView(getMemory());
        dv.setBigUint64(buf_ptr, 0n, true);
        dv.setBigUint64(buf_ptr + 8, 0n, true);
        dv.setUint8(buf_ptr + 16, 4);
        dv.setBigUint64(buf_ptr + 24, 1n, true);
        dv.setBigUint64(buf_ptr + 32, BigInt(st.size), true);
        dv.setBigUint64(buf_ptr + 40, BigInt(Math.floor(st.atimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 48, BigInt(Math.floor(st.mtimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 56, BigInt(Math.floor(st.ctimeMs * 1e6)), true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_filestat_get FAILED: ${e && e.message}`); return 8; }
    },
    fd_seek: (fd, offset64, whence, newoffset_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setBigUint64(newoffset_ptr, 0n, true); } catch (_) {} return 8; }
      try {
        const offset = BigInt.asIntN(64, BigInt(offset64));
        let base;
        if (whence === 0) base = 0n;
        else if (whence === 1) base = BigInt(entry.pos);
        else base = BigInt(fs.fstatSync(entry.nodeFd).size);
        const next = base + offset;
        entry.pos = Number(next < 0n ? 0n : next);
        new DataView(getMemory()).setBigUint64(newoffset_ptr, BigInt(entry.pos), true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_seek FAILED: ${e && e.message}`); return 8; }
    },
    fd_read: (fd, iovs_ptr, iovs_len, nread_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setUint32(nread_ptr, 0, true); } catch (_) {} return 8; }
      try {
        const buf = getMemory();
        const dv = new DataView(buf);
        let total = 0;
        const iovsBase = iovs_ptr >>> 0;
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
          const ptr = dv.getUint32(base, true) >>> 0;
          const len = dv.getUint32(base + 4, true) >>> 0;
          if (len === 0) continue;
          const dest = Buffer.from(buf, ptr, len);
          const n = fs.readSync(entry.nodeFd, dest, 0, len, entry.pos);
          entry.pos += n;
          total += n;
          if (n < len) break;
        }
        dv.setUint32(nread_ptr, total, true);
        return 0;
      } catch (e) { return 8; }
    },
    fd_pread: (fd, iovs_ptr, iovs_len, offset64, nread_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setUint32(nread_ptr, 0, true); } catch (_) {} return 8; }
      try {
        const offset = Number(BigInt.asUintN(64, BigInt(offset64)));
        const buf = getMemory();
        const dv = new DataView(buf);
        let total = 0;
        const iovsBase = iovs_ptr >>> 0;
        let pos = offset;
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
          const ptr = dv.getUint32(base, true) >>> 0;
          const len = dv.getUint32(base + 4, true) >>> 0;
          if (len === 0) continue;
          const dest = Buffer.from(buf, ptr, len);
          const n = fs.readSync(entry.nodeFd, dest, 0, len, pos);
          pos += n;
          total += n;
          if (n < len) break;
        }
        dv.setUint32(nread_ptr, total, true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_pread FAILED: ${e && e.message}`); return 8; }
    },
    fd_pwrite: (fd, iovs_ptr, iovs_len, offset64, nwritten_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setUint32(nwritten_ptr, 0, true); } catch (_) {} return 8; }
      try {
        const offset = Number(BigInt.asUintN(64, BigInt(offset64)));
        const buf = getMemory();
        const dv = new DataView(buf);
        let total = 0;
        const iovsBase = iovs_ptr >>> 0;
        let pos = offset;
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
          const ptr = dv.getUint32(base, true) >>> 0;
          const len = dv.getUint32(base + 4, true) >>> 0;
          if (len === 0) continue;
          const src = Buffer.from(buf, ptr, len);
          const n = fs.writeSync(entry.nodeFd, src, 0, len, pos);
          pos += n;
          total += n;
        }
        dv.setUint32(nwritten_ptr, total, true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_pwrite FAILED: ${e && e.message}`); return 8; }
    },
    fd_sync: (fd) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 8;
      try { fs.fsyncSync(entry.nodeFd); return 0; } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_sync FAILED: ${e && e.message}`); return 8; }
    },
    fd_datasync: (fd) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 8;
      try { fs.fdatasyncSync(entry.nodeFd); return 0; } catch (e) { return 8; }
    },
    fd_filestat_set_size: (fd, size64) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 8;
      try {
        const size = Number(BigInt.asUintN(64, BigInt(size64)));
        fs.ftruncateSync(entry.nodeFd, size);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_filestat_set_size FAILED: ${e && e.message}`); return 8; }
    },
    path_create_directory: (_dirfd, path_ptr, path_len) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.mkdirSync(absPath, { recursive: true });
        return 0;
      } catch (e) {
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_create_directory FAILED: ${e && e.message}`);
        return e && e.code === 'EEXIST' ? 0 : 8;
      }
    },
    path_unlink_file: (_dirfd, path_ptr, path_len) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.unlinkSync(absPath);
        return 0;
      } catch (e) {
        return e && e.code === 'ENOENT' ? 44 : 8;
      }
    },
    path_remove_directory: (_dirfd, path_ptr, path_len) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.rmdirSync(absPath);
        return 0;
      } catch (e) {
        if (e && e.code === 'ENOENT') return 44;
        if (e && e.code === 'ENOTEMPTY') return 55;
        return 8;
      }
    },
    path_filestat_set_times: (_dirfd, _flags, path_ptr, path_len, atim64, mtim64, fst_flags) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        const FILESTAT_SET_ATIM = 0x1, FILESTAT_SET_ATIM_NOW = 0x2, FILESTAT_SET_MTIM = 0x4, FILESTAT_SET_MTIM_NOW = 0x8;
        const st = fs.statSync(absPath);
        const nowMs = Date.now();
        let atimeMs = st.atimeMs;
        let mtimeMs = st.mtimeMs;
        if (fst_flags & FILESTAT_SET_ATIM_NOW) atimeMs = nowMs;
        else if (fst_flags & FILESTAT_SET_ATIM) atimeMs = Number(BigInt.asUintN(64, BigInt(atim64))) / 1e6;
        if (fst_flags & FILESTAT_SET_MTIM_NOW) mtimeMs = nowMs;
        else if (fst_flags & FILESTAT_SET_MTIM) mtimeMs = Number(BigInt.asUintN(64, BigInt(mtim64))) / 1e6;
        fs.utimesSync(absPath, atimeMs / 1000, mtimeMs / 1000);
        return 0;
      } catch (e) {
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_filestat_set_times FAILED: ${e && e.message}`);
        return e && e.code === 'ENOENT' ? 44 : 8;
      }
    },
    path_open: (_dirfd, _dirflags, path_ptr, path_len, oflags, _rights_base, _rights_inherit, fdflags, opened_fd_ptr) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        const OFLAGS_CREAT = 1, OFLAGS_EXCL = 2, OFLAGS_TRUNC = 8;
        let nodeFlags = 'r+';
        const creat = (oflags & OFLAGS_CREAT) !== 0;
        const excl = (oflags & OFLAGS_EXCL) !== 0;
        const trunc = (oflags & OFLAGS_TRUNC) !== 0;
        if (excl && creat) nodeFlags = 'wx+';
        else if (trunc) nodeFlags = 'w+';
        else if (creat) nodeFlags = fs.existsSync(absPath) ? 'r+' : 'w+';
        else nodeFlags = 'r+';
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_open: rel=${relPath} abs=${absPath} oflags=${oflags} nodeFlags=${nodeFlags}`);
        const nodeFd = fs.openSync(absPath, nodeFlags);
        const wasiFd = wasiNextFdRef.value++;
        wasiOpenFiles.set(wasiFd, { nodeFd, pos: 0, path: absPath });
        new DataView(buf).setUint32(opened_fd_ptr, wasiFd, true);
        return 0;
      } catch (e) {
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_open FAILED: ${e && e.message}`);
        return e && /ENOENT/.test(e.code || '') ? 44 : 8;
      }
    },
    path_filestat_get: (_dirfd, _flags, path_ptr, path_len, buf_ptr) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        const st = fs.statSync(absPath);
        const dv = new DataView(buf);
        dv.setBigUint64(buf_ptr, 0n, true);
        dv.setBigUint64(buf_ptr + 8, 0n, true);
        dv.setUint8(buf_ptr + 16, st.isDirectory() ? 3 : 4);
        dv.setBigUint64(buf_ptr + 24, 1n, true);
        dv.setBigUint64(buf_ptr + 32, BigInt(st.size), true);
        dv.setBigUint64(buf_ptr + 40, BigInt(Math.floor(st.atimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 48, BigInt(Math.floor(st.mtimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 56, BigInt(Math.floor(st.ctimeMs * 1e6)), true);
        return 0;
      } catch (e) {
        return e && /ENOENT/.test(e.code || '') ? 44 : 8;
      }
    },
    poll_oneoff: () => 0,
    sched_yield: () => 0,
  };
  if (process.env.PLUGKIT_DEBUG_WASI) {
    for (const k of Object.keys(shim)) {
      const orig = shim[k];
      shim[k] = (...args) => {
        const r = orig(...args);
        try { console.error(`[plugkit-wasm] wasi.${k}(${args.map(a => typeof a === 'bigint' ? a.toString() : a).join(',')}) -> ${r}`); } catch (_) {}
        return r;
      };
    }
  }
  return new Proxy(shim, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        console.error(`[plugkit-wasm] unimplemented WASI call: ${String(prop)} args=${args.length}`);
        return 8;
      };
    }
  });
}

export { wasiFilesystemRootFor, makeWasiResolvePath, createWasiShim };
