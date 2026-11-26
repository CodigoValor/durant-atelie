import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const entry = new URL('../supabase/functions/enviar-convite/index.ts', import.meta.url);
const source = readFileSync(entry, 'utf8').replace(/^import .*\n/m, '');
const logs = [];
let serve;
const fixture = {
  id: 'invite-test',
  envio: 1,
  email: 'convite@example.test',
  papel: 'admin',
  expira_em: new Date(Date.now() + 86_400_000).toISOString(),
};
const env = {
  SUPABASE_URL: 'https://azkvclwozhneyougtcbn.supabase.co',
  SUPABASE_ANON_KEY: 'fake-anon-key',
  RESEND_API_KEY: 'fake-resend-key',
};

vm.runInNewContext(stripTypeScriptTypes(source), {
  Deno: { env: { get: name => env[name] }, serve: handler => { serve = handler; } },
  console: { error: (...args) => logs.push(args) },
  createClient: () => ({ rpc: async () => ({ data: [fixture], error: null }) }),
  fetch: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).to, [fixture.email]);
    return new Response('Provider response containing convite@example.test', { status: 422 });
  },
  Response,
});

const response = await serve(new Request('https://localhost/enviar-convite', {
  method: 'POST',
  headers: { authorization: 'Bearer fake-synthetic-session' },
  body: JSON.stringify({ token: 'synthetic-invite-token' }),
}));
assert.equal(response.status, 502);
assert.deepEqual(await response.json(), { error: 'falha_no_envio' });
assert.equal(JSON.stringify(logs), '[["resend",422]]');
console.log('ok - falha do provedor registra somente o status e mantém o erro público');
