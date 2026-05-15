const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('backend/server.js', 'utf8');
try {
  new vm.Script(code, { filename: 'backend/server.js' });
  console.log('parse ok');
} catch (err) {
  console.error(err && err.message ? err.message : err);
  if (err.loc) {
    console.error('line', err.loc.line, 'column', err.loc.column);
  }
  process.exit(1);
}
