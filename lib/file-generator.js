const fs = require('fs');
const path = require('path');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const writeFile = (filePath, content) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
};

const readTemplate = (templatePath) => {
  if (!fs.existsSync(templatePath)) {
    return null;
  }
  return fs.readFileSync(templatePath, 'utf-8');
};

const copyFile = (src, dst) => {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
};

const createStructure = (baseDir, structure) => {
  Object.entries(structure).forEach(([filePath, content]) => {
    writeFile(path.join(baseDir, filePath), content);
  });
};

const validateGeneratedFiles = (baseDir, expectedFiles) => {
  const missing = [];
  expectedFiles.forEach(file => {
    const fullPath = path.join(baseDir, file);
    if (!fs.existsSync(fullPath)) {
      missing.push(file);
    }
  });
  return missing.length === 0 ? null : missing;
};

const getFilesRecursive = (dir) => {
  const files = [];
  const walk = (current) => {
    const contents = fs.readdirSync(current, { withFileTypes: true });
    contents.forEach(entry => {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(dir, fullPath);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(relPath);
      }
    });
  };
  walk(dir);
  return files.sort();
};

const compareDirectories = (dir1, dir2, ignorePatterns = []) => {
  const files1 = getFilesRecursive(dir1);
  const files2 = getFilesRecursive(dir2);

  const shouldIgnore = (file) => {
    return ignorePatterns.some(p => file.includes(p));
  };

  const filtered1 = files1.filter(f => !shouldIgnore(f));
  const filtered2 = files2.filter(f => !shouldIgnore(f));

  const diff = {
    onlyInDir1: [],
    onlyInDir2: [],
    different: []
  };

  const allFiles = new Set([...filtered1, ...filtered2]);

  allFiles.forEach(file => {
    const path1 = path.join(dir1, file);
    const path2 = path.join(dir2, file);
    const exists1 = fs.existsSync(path1);
    const exists2 = fs.existsSync(path2);

    if (exists1 && !exists2) {
      diff.onlyInDir1.push(file);
    } else if (!exists1 && exists2) {
      diff.onlyInDir2.push(file);
    } else if (exists1 && exists2) {
      const content1 = fs.readFileSync(path1, 'utf-8');
      const content2 = fs.readFileSync(path2, 'utf-8');
      if (content1 !== content2) {
        diff.different.push(file);
      }
    }
  });

  return diff;
};

module.exports = {
  ensureDir,
  writeFile,
  readTemplate,
  copyFile,
  createStructure,
  validateGeneratedFiles,
  getFilesRecursive,
  compareDirectories
};
