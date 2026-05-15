const fs = require('fs');
const code = fs.readFileSync('backend/server.js', 'utf8');
const stack = [];
let inSingle = false;
let inDouble = false;
let inTemplate = false;
let inLineComment = false;
let inBlockComment = false;
let escaped = false;
let templateDepth = 0;
let line = 1;
let col = 0;
for (let i = 0; i < code.length; i++) {
  const ch = code[i];
  const next = code[i+1];
  col += 1;
  if (ch === '\n') { line += 1; col = 0; inLineComment = false; escaped = false; continue; }
  if (inLineComment) continue;
  if (inBlockComment) {
    if (ch === '*' && next === '/') { inBlockComment = false; i += 1; col += 1; }
    continue;
  }
  if (escaped) { escaped = false; continue; }
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
    if (ch === '\\') escaped = true;
    else if (ch === '`') {
      inTemplate = false;
      templateDepth -= 1;
    } else if (ch === '$' && next === '{') {
      stack.push(['${', line, col]); i += 1; col += 1;
    }
    continue;
  }
  if (ch === '/' && next === '/') {
    inLineComment = true;
    i += 1; col += 1;
    continue;
  }
  if (ch === '/' && next === '*') {
    inBlockComment = true;
    i += 1; col += 1;
    continue;
  }
  if (ch === "'") { inSingle = true; continue; }
  if (ch === '"') { inDouble = true; continue; }
  if (ch === '`') { inTemplate = true; templateDepth += 1; continue; }
  if ('([{'.includes(ch)) { stack.push([ch, line, col]); continue; }
  if (']})'.includes(ch)) {
    if (!stack.length) { console.log('unmatched closing', ch, line, col); process.exit(0); }
    const [o, ol, oc] = stack.pop();
    if (o === '{' && ch !== '}') { console.log('mismatch', o, ch, ol, oc); process.exit(0); }
    if (o === '[' && ch !== ']') { console.log('mismatch', o, ch, ol, oc); process.exit(0); }
    if (o === '(' && ch !== ')') { console.log('mismatch', o, ch, ol, oc); process.exit(0); }
    if (o === '${' && ch !== '}') { console.log('mismatch', o, ch, ol, oc); process.exit(0); }
    continue;
  }
}
if (stack.length) {
  console.log('unmatched opening', stack[stack.length-1]);
  process.exit(1);
}
console.log('balanced');
