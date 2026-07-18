import fs from 'fs';

function atomicWriteRaw(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function atomicWriteJson(filePath, obj) {
  atomicWriteRaw(filePath, JSON.stringify(obj, null, 2));
}

function readJsonFile(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (_) { return fallback; }
}

function writeJsonFile(fp, value) {
  try { atomicWriteJson(fp, value); } catch (_) {}
}

export { atomicWriteRaw, atomicWriteJson, readJsonFile, writeJsonFile };
