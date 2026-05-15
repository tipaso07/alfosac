const fs = require('fs');
const code = fs.readFileSync('backend/server.js', 'utf8');
const stack = [];
let inSingle = false, inDouble = false, inTemplate = false, inLine = false, inBlock = false, escaped = false;
let line = 1;
for (let i = 0; i < code.length; i++) {
  const ch = code[i];
  const next = code[i + 1];
  if (ch === '\n') { line++; inLine = false; escaped = false; continue; }
  if (inLine) continue;
  if (inBlock) {
    if (ch === '*' && next === '/') { inBlock = false; i++; }
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
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '`') { inTemplate = false; continue; }
    if (ch === '$' && next === '{') { stack.push(['TEMPLATE_EXPR', line, i+1]); i++; continue; }
    if (ch === '}') {
      const top = stack[stack.length - 1];
      if (top && top[0] === 'TEMPLATE_EXPR') {
        stack.pop();
        continue;
      }
    }
    if ('([{'.includes(ch)) { stack.push([ch, line, i+1]); continue; }
    if (']})'.includes(ch)) {
      const top = stack.pop();
      if (!top) { console.log('unmatched closing', ch, line, i+1); process.exit(1); }
      const [o] = top;
      if ((o==='{'&&ch!=='}') || (o==='['&&ch!==']') || (o==='('&&ch!==')')) { console.log('mismatch', o, ch, top[1], top[2]); process.exit(1); }
      continue;
    }
    continue;
  }
  if (ch === '/' && next === '/') { inLine = true; continue; }
  if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
  if (ch === "'") { inSingle = true; continue; }
  if (ch === '"') { inDouble = true; continue; }
  if (ch === '`') { inTemplate = true; continue; }
  if ('([{'.includes(ch)) { stack.push([ch, line, i+1]); continue; }
  if (']})'.includes(ch)) {
    const top = stack.pop();
    if (!top) { console.log('unmatched closing', ch, line, i+1); process.exit(1); }
    const [o] = top;
    if ((o==='{'&&ch!=='}') || (o==='['&&ch!==']') || (o==='('&&ch!==')')) { console.log('mismatch', o, ch, top[1], top[2]); process.exit(1); }
    continue;
  }
}
if (stack.length) {
  console.log('unmatched opening', stack[stack.length-1]);
  process.exit(1);
}
console.log('balanced');
