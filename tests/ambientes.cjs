// Garante que só os endereços oficiais usam o banco REAL; qualquer outro usa a homologação.
const fs = require('fs'), vm = require('vm');
const codigo = fs.readFileSync(__dirname + '/../config.js', 'utf8');
const PROD = 'https://jkhjixfdlpucaebulpdh.supabase.co', HOMO = 'https://azkvclwozhneyougtcbn.supabase.co';
let falhas = 0;
function cfg(host) { const w = {}; vm.runInNewContext(codigo, { window: w, location: { hostname: host } }); return w.SUPABASE_CFG; }
function ok(c, msg) { console.log((c ? '  ok  ' : ' FALHA ') + msg); if (!c) falhas++; }
for (const h of ['sistema.henriquedurant.com', 'SISTEMA.henriquedurant.com', 'painel.henriquedurant.com', 'durant-atelie.vercel.app'])
  ok(cfg(h).url === PROD && cfg(h).ambiente === 'producao', `${h} -> produção`);
for (const h of ['localhost', '127.0.0.1', 'homolog.henriquedurant.com', 'painel-homolog.henriquedurant.com', 'durant-atelie-git-homologacao-codigo-do-valor.vercel.app',
  'durant-atelie-m2dasworz-codigo-do-valor.vercel.app', 'sistema.henriquedurant.com.evil.com', 'evil-sistema.henriquedurant.com', ''])
  ok(cfg(h).url === HOMO && cfg(h).ambiente === 'homologacao', `${JSON.stringify(h)} -> homologação`);
ok(cfg('x').key !== cfg('sistema.henriquedurant.com').key, 'chaves diferentes entre os ambientes');
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK'); process.exit(falhas ? 1 : 0);
