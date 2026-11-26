// Login por CPF: recebe { cpf, password }, descobre o e-mail da conta no servidor e entra com ele.
// O navegador nunca recebe o e-mail de um CPF. Erro é sempre o mesmo ("credenciais inválidas"),
// exista o CPF ou não, e 5 erros bloqueiam o CPF por 15 minutos (ver migração 0024).
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "metodo" });
  let cpf = "", password = "";
  try {
    const b = await req.json();
    cpf = String(b.cpf ?? "").replace(/\D/g, "");
    password = String(b.password ?? "");
  } catch (_) {
    return json(400, { error: "pedido_invalido" });
  }
  if (cpf.length !== 11 || !password || password.length > 200) return json(401, { error: "invalid_credentials" });

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const { data } = await admin.rpc("login_cpf_email", { p_cpf: cpf });
  const row = Array.isArray(data) ? data[0] : null;
  if (row && row.bloqueado) return json(429, { error: "muitas_tentativas" });
  if (!row || !row.email) {
    await pausa(500); // mesmo tempo de resposta de uma senha errada
    return json(401, { error: "invalid_credentials" });
  }
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: row.email, password }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    await admin.rpc("login_cpf_falha", { p_cpf: cpf });
    return json(401, { error: "invalid_credentials" });
  }
  await admin.rpc("login_cpf_ok", { p_cpf: cpf });
  return json(200, { access_token: t.access_token, refresh_token: t.refresh_token });
});
