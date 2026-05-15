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
  runStep('init-db.js');
  runStep('run-migrations.js');
  runStep('server.js', {
    RUN_DEMO_SEED: 'true',
    RUN_DEMO_SEED_ONLY: 'true',
  });
  runStep('seed-demo-users.js');

  console.log('\nBase limpia y datos de prueba cargados correctamente.');
} catch (error) {
  console.error('\nNo se pudo preparar la base de datos de prueba.');
  process.exit(error?.status || 1);
}