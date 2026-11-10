import { resolvePath } from './project.mjs';

export function createFsImports(project, { bytesAt, float64At }) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const handles = new Map();
  let next = 3;
  const absolute = (ptr, len) => resolvePath(decoder.decode(bytesAt(ptr, len)));
  const writeStat = (info, out) => {
    if (info === null) return -1;
    const slots = float64At(out, 4);
    slots[0] = info.dir ? 2 : 1;
    slots[1] = info.size;
    slots[2] = info.mtimeMs;
    slots[3] = info.dir ? 0o40755 : 0o100644;
    return 0;
  };
  return {
    tjs_fs_open(ptr, len, create) {
      const path = absolute(ptr, len);
      const info = project.stat(path);
      if (create || info === null || info.dir) return -1;
      const fd = next;
      next += 1;
      handles.set(fd, project.bytes(path));
      return fd;
    },
    tjs_fs_close(fd) {
      handles.delete(fd);
    },
    tjs_fs_size(fd) {
      const bytes = handles.get(fd);
      return bytes === undefined ? -1 : bytes.length;
    },
    tjs_fs_read(fd, ptr, len, offset) {
      const bytes = handles.get(fd);
      if (bytes === undefined) return -1;
      const count = Math.max(0, Math.min(len, bytes.length - offset));
      bytesAt(ptr, count).set(bytes.subarray(offset, offset + count));
      return count;
    },
    tjs_fs_write() {
      return -1;
    },
    tjs_fs_truncate() {
      return -1;
    },
    tjs_fs_access(ptr, len) {
      return project.stat(absolute(ptr, len)) === null ? 0 : 1;
    },
    tjs_fs_delete() {
      return -1;
    },
    tjs_fs_stat(ptr, len, out) {
      return writeStat(project.stat(absolute(ptr, len)), out);
    },
    tjs_fs_lstat(ptr, len, out) {
      return writeStat(project.stat(absolute(ptr, len)), out);
    },
    tjs_fs_readdir(ptr, len, out, cap) {
      const names = project.names(absolute(ptr, len));
      if (names === null) return -1;
      const bytes = encoder.encode(names.map((name) => name + '\u0000').join(''));
      if (bytes.length <= cap) bytesAt(out, bytes.length).set(bytes);
      return bytes.length;
    },
    tjs_fs_mkdir() {
      return -1;
    },
    tjs_fs_rmdir() {
      return -1;
    },
    tjs_fs_symlink() {
      return -1;
    },
    tjs_fs_readlink() {
      return -1;
    },
    tjs_fs_resolve(ptr, len, out, cap) {
      const bytes = encoder.encode(absolute(ptr, len));
      if (bytes.length >= cap) return -1;
      bytesAt(out, bytes.length).set(bytes);
      return bytes.length;
    },
    tjs_fs_realpath(ptr, len, out, cap) {
      const path = absolute(ptr, len);
      const bytes = encoder.encode(path);
      if (project.stat(path) === null || bytes.length >= cap) return -1;
      bytesAt(out, bytes.length).set(bytes);
      return bytes.length;
    },
  };
}
