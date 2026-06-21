const fs = require('fs');
const path = require('path');

const SKILL_MD_PATH = path.join(__dirname, 'SKILL.md');

function loadCanonicalSkill() {
  return fs.readFileSync(SKILL_MD_PATH, 'utf-8');
}

module.exports = { loadCanonicalSkill, SKILL_MD_PATH };
