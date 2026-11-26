import assert from 'node:assert/strict';

const hosts = [
  ['https://homolog.henriquedurant.com', 'adapter.js'],
  ['https://painel-homolog.henriquedurant.com', 'painel.js'],
];
const project = 'https://azkvclwozhneyougtcbn.supabase.co';
const expectedCommit = process.env.ALINHAVO_EXPECTED_COMMIT;
if (expectedCommit && !/^[a-f0-9]{40}$/.test(expectedCommit)) {
  throw new Error('SHA esperado inválido');
}

function get(origin, path) {
  return fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(12_000) });
}

async function check(origin, marker) {
  const [page, config, asset, source, version] = await Promise.all([
    get(origin, '/'),
    get(origin, '/config.js'),
    get(origin, '/' + marker),
    get(origin, '/supabase/migrations/0026_convite_envio_email.sql'),
    get(origin, '/versao.json'),
  ]);
  assert.equal(page.status, 200, `${origin} página inicial`);
  assert.ok((await page.text()).includes(marker), `${origin} página incorreta`);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff', `${origin} cabeçalhos`);
  assert.equal(asset.status, 200, `${origin} JavaScript da página`);
  assert.match(asset.headers.get('content-type') || '', /javascript/, `${origin} tipo do JavaScript`);
  assert.equal(version.status, 200, `${origin} versão publicada`);
  if (expectedCommit) {
    assert.equal((await version.json()).commit, expectedCommit, `${origin} commit publicado`);
  }
  assert.equal(config.status, 200, `${origin} configuração`);
  const script = await config.text();
  const url = script.match(/var HOMOLOGACAO\s*=\s*\{[^}]*url:\s*'([^']+)'/)?.[1];
  assert.equal(url, project, `${origin} configuração do banco`);
  assert.equal(source.status, 404, `${origin} arquivos internos fora do deploy`);
  console.log(`${origin} OK`);
}

const checks = await Promise.allSettled(hosts.map(args => check(...args)));
for (const result of checks) {
  if (result.status === 'rejected') {
    console.error(result.reason.message);
    process.exitCode = 1;
  }
}
