import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const root = new URL('../', import.meta.url);
const files = [
  'index.html', 'painel.html', 'privacidade.html', 'tecidos/index.html', 'tecidos/pedido.html',
  'config.js', 'adapter.js', 'painel.js', 'vendor/supabase.js',
  'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
];
const assets = ['01', '02', '04', '06', '07', '08', '10', '14', '15', '16'];
await rm(output, { recursive: true, force: true });
await Promise.all(
  ['', 'tecidos/', 'vendor/', 'assets/entrada/'].map(dir => mkdir(new URL(dir, output), { recursive: true })),
);
for (const file of [...files, ...assets.map(id => `assets/entrada/${id}.jpg`)]) {
  await cp(new URL(file, root), new URL(file, output));
}

const commit = process.env.VERCEL_GIT_COMMIT_SHA;
if (commit && !/^[a-f0-9]{40}$/.test(commit)) {
  throw new Error('SHA de deploy inválido');
}
await writeFile(new URL('versao.json', output), JSON.stringify({ commit: commit || null }) + '\n');
