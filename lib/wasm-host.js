const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class WasmHost {
  constructor(wasmPath) {
    this.wasmPath = wasmPath;
    this.instance = null;
    this.memory = null;
  }

  async init() {
    try {
      const wasmBuffer = fs.readFileSync(this.wasmPath);
      const wasmModule = new WebAssembly.Module(wasmBuffer);

      const importObject = {
        host: {
          host_fs_read: this.hostFsRead.bind(this),
          host_fs_write: this.hostFsWrite.bind(this),
          host_fs_readdir: this.hostFsReaddir.bind(this),
          host_fs_stat: this.hostFsStat.bind(this),
          host_kv_get: this.hostKvGet.bind(this),
          host_kv_put: this.hostKvPut.bind(this),
          host_kv_query: this.hostKvQuery.bind(this),
          host_fetch: this.hostFetch.bind(this),
          host_vec_search: this.hostVecSearch.bind(this),
          host_browser_spawn: this.hostBrowserSpawn.bind(this),
          host_browser_eval: this.hostBrowserEval.bind(this),
          host_browser_close: this.hostBrowserClose.bind(this),
          host_exec_js: this.hostExecJs.bind(this),
          host_log: this.hostLog.bind(this),
          host_now_ms: this.hostNowMs.bind(this),
          host_env_get: this.hostEnvGet.bind(this),
        },
        env: {
          memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
        }
      };

      this.instance = new WebAssembly.Instance(wasmModule, importObject);
      this.memory = importObject.env.memory;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  readString(offset, len) {
    const buf = new Uint8Array(this.memory.buffer, offset, len);
    return new TextDecoder().decode(buf);
  }

  writeString(str) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str);
    const len = encoded.length;
    const offset = this.instance.exports.plugkit_alloc(len);
    const buf = new Uint8Array(this.memory.buffer, offset, len);
    buf.set(encoded);
    return [offset, len];
  }

  hostFsRead(pathPtr, pathLen) {
    try {
      const pathStr = this.readString(pathPtr, pathLen);
      const content = fs.readFileSync(pathStr, 'utf8');
      const [offset, len] = this.writeString(content);
      return offset;
    } catch (err) {
      return 0;
    }
  }

  hostFsWrite(pathPtr, pathLen, dataPtr, dataLen) {
    try {
      const pathStr = this.readString(pathPtr, pathLen);
      const data = this.readString(dataPtr, dataLen);
      fs.writeFileSync(pathStr, data, 'utf8');
      return 1;
    } catch (err) {
      return 0;
    }
  }

  hostFsReaddir(pathPtr, pathLen) {
    try {
      const pathStr = this.readString(pathPtr, pathLen);
      const entries = fs.readdirSync(pathStr);
      const result = JSON.stringify(entries);
      const [offset] = this.writeString(result);
      return offset;
    } catch (err) {
      return 0;
    }
  }

  hostFsStat(pathPtr, pathLen) {
    try {
      const pathStr = this.readString(pathPtr, pathLen);
      const stat = fs.statSync(pathStr);
      const result = JSON.stringify({
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtime: stat.mtime.getTime(),
      });
      const [offset] = this.writeString(result);
      return offset;
    } catch (err) {
      return 0;
    }
  }

  hostKvGet(keyPtr, keyLen) {
    return 0;
  }

  hostKvPut(keyPtr, keyLen, valPtr, valLen) {
    return 1;
  }

  hostKvQuery(queryPtr, queryLen) {
    return 0;
  }

  hostFetch(urlPtr, urlLen, optsPtr, optsLen) {
    return 0;
  }

  hostVecSearch(queryPtr, queryLen) {
    return 0;
  }

  hostBrowserSpawn(urlPtr, urlLen) {
    return 0;
  }

  hostBrowserEval(sessionPtr, sessionLen, jsPtr, jsLen) {
    return 0;
  }

  hostBrowserClose(sessionPtr, sessionLen) {
    return 1;
  }

  hostExecJs(codePtr, codeLen) {
    try {
      const code = this.readString(codePtr, codeLen);
      const result = eval(`(${code})`);
      const [offset] = this.writeString(JSON.stringify(result));
      return offset;
    } catch (err) {
      return 0;
    }
  }

  hostLog(msgPtr, msgLen) {
    const msg = this.readString(msgPtr, msgLen);
    console.log(msg);
    return 1;
  }

  hostNowMs() {
    return Date.now();
  }

  hostEnvGet(keyPtr, keyLen) {
    const key = this.readString(keyPtr, keyLen);
    const val = process.env[key] || '';
    const [offset] = this.writeString(val);
    return offset;
  }

  async dispatch(verb, body) {
    if (!this.instance) {
      const initResult = await this.init();
      if (!initResult.ok) return initResult;
    }

    try {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const [verbOffset, verbLen] = this.writeString(verb);
      const [bodyOffset, bodyLen] = this.writeString(bodyStr);

      const resultPtr = this.instance.exports.dispatch_verb(verbOffset, verbLen, bodyOffset, bodyLen);
      if (resultPtr === 0) {
        return { ok: false, error: 'dispatch_verb returned null' };
      }

      const resultStr = this.readString(resultPtr, 1024);
      try {
        return JSON.parse(resultStr);
      } catch {
        return { ok: true, output: resultStr };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async hook(name, body) {
    if (!this.instance) {
      const initResult = await this.init();
      if (!initResult.ok) return initResult;
    }

    try {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const [nameOffset, nameLen] = this.writeString(name);
      const [bodyOffset, bodyLen] = this.writeString(bodyStr);

      const hookFn = this.instance.exports[`hook_${name}`];
      if (!hookFn) {
        return { ok: false, error: `hook_${name} not found` };
      }

      const resultPtr = hookFn(bodyOffset, bodyLen);
      if (resultPtr === 0) {
        return { ok: false, error: `hook_${name} returned null` };
      }

      const resultStr = this.readString(resultPtr, 1024);
      try {
        return JSON.parse(resultStr);
      } catch {
        return { ok: true, output: resultStr };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = WasmHost;
