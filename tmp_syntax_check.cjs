const fs = require('fs');
const text = fs.readFileSync('backend/server.js', 'utf8').split(/\r?\n/);
const stack = [];
for (let i = 0; i < text.length; i++) {
  const line = text[i];
  for (const ch of line) {
    if ('{[('.includes(ch)) stack.push([ch, i + 1]);
    else if ('}])'.includes(ch)) {
      if (!stack.length) {
        console.log('unmatched closing', ch, i + 1);
        process.exit(0);
      }
      const [o, oi] = stack.pop();
      if ((o === '{' && ch !== '}') || (o === '[' && ch !== ']') || (o === '(' && ch !== ')')) {
        console.log('mismatch', o, ch, oi, i + 1);
        process.exit(0);
      }
    }
  }
}
if (stack.length) {
  console.log('unmatched opening', stack[stack.length - 1][0], stack[stack.length - 1][1]);
} else {
  console.log('balanced');
}
