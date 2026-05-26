const { execFileSync } = require('child_process');

const backendDir = __dirname;
const nodeExecutable = process.execPath;

const baseEnv = {
  ...process.env,
};

const runStep = (scriptName, extraEnv = {}) => {
  execFileSync(nodeExecutable, [scriptName], {
    cwd: backendDir,
    stdio: 'inherit',
    env: {
      ...baseEnv,
      ...extraEnv,
    },
  });
};

try {
  runStep('reset-db.js');
  runStep('restore-backup.js');

  console.log('\nBase vacia restaurada correctamente.');
} catch (error) {
  console.error('\nNo se pudo restaurar la base vacia.');
  process.exit(error?.status || 1);
}
