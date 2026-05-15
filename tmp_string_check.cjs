const fs = require('fs');
const code = fs.readFileSync('backend/server.js', 'utf8');
let inSingle = false;
let inDouble = false;
let inTemplate = false;
let inLine = false;
let inBlock = false;
let escaped = false;
let line = 1;
let startLine = 1;
for (let i = 0; i < code.length; i++) {
  const ch = code[i];
  const next = code[i + 1];
  if (ch === '\n') {
    line += 1;
    inLine = false;
    escaped = false;
    continue;
  }

  if (inLine) {
    continue;
  }

  if (inBlock) {
    if (ch === '*' && next === '/') {
      inBlock = false;
      i += 1;
    }
    continue;
  }

  if (escaped) {
    escaped = false;
    continue;
  }

  if (inSingle) {
    if (ch === '\\') escaped = true;
    else if (ch === "'") inSingle = false;
    continue;
  }

  if (inDouble) {
    if (ch === '\\') escaped = true;
    else if (ch === '"') inDouble = false;
    continue;
  }

  if (inTemplate) {
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = false;
      continue;
    }
    continue;
  }

  if (ch === '/' && next === '/') {
    inLine = true;
    continue;
  }

  if (ch === '/' && next === '*') {
    inBlock = true;
    i += 1;
    continue;
  }

  if (ch === "'") {
    inSingle = true;
    continue;
  }

  if (ch === '"') {
    inDouble = true;
    continue;
  }

  if (ch === '`') {
    inTemplate = true;
    startLine = line;
    continue;
  }
}
console.log('inSingle', inSingle, 'inDouble', inDouble, 'inTemplate', inTemplate, 'line', line, 'startLine', startLine);