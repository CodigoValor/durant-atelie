import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tests = readdirSync(path.join(root, 'tests'))
  .filter(name => /\.(cjs|mjs)$/.test(name)).sort();
if (!tests.length) throw new Error('Nenhuma suíte encontrada');
const failed = [];
for (const name of tests) {
  console.log('\n=== ' + name + ' ===');
  const result = spawnSync(process.execPath, [path.join(root, 'tests', name)], {
    cwd: root, stdio: 'inherit', timeout: 180_000,
  });
  if (result.status !== 0 || result.error) {
    failed.push(name);
    console.error('FALHA:', name, result.error?.message ?? result.signal ?? result.status);
  }
}
console.log('\nResultado: ' + (tests.length - failed.length) + '/' + tests.length + ' suítes passaram.');
if (failed.length) console.error('Suítes com falha: ' + failed.join(', '));
process.exitCode = failed.length ? 1 : 0;
