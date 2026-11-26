// Envia o e-mail de convite. Recebe { token } (o código do link, mostrado uma vez ao criar o convite).
// Quem chama precisa estar logado e poder convidar: o banco confere (convite_para_envio) e limita
// 3 e-mails por convite. O endereço de destino e o nome da empresa vêm do banco, nunca do navegador.
// O link usa o endereço fixo do ambiente (AMBIENTES), nunca um endereço enviado pelo navegador.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
// O endereço do sistema e o prefixo do assunto vêm do projeto em que a função roda (nunca do navegador).
const AMBIENTES: Record<string, { sistema: string; prefixo: string }> = {
  azkvclwozhneyougtcbn: { sistema: "https://homolog.henriquedurant.com", prefixo: "[Homologação] " },
  jkhjixfdlpucaebulpdh: { sistema: "https://sistema.henriquedurant.com", prefixo: "" },
};
const AMB = AMBIENTES[(URL_.match(/^https:\/\/([a-z0-9]+)\./) ?? [])[1] ?? ""];
const SISTEMA = AMB?.sistema ?? "";
const REMETENTE = Deno.env.get("REMETENTE") ?? "Alinhavo <convite@envio.henriquedurant.com>";
const PREFIXO = AMB?.prefixo ?? "";
const RESPONDER_PARA = Deno.env.get("RESPONDER_PARA") ?? "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const PAPEL: Record<string, string> = { admin: "administrador", usuario: "usuário", parceiro: "ateliê parceiro" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "metodo" });
  if (!RESEND || !SISTEMA) return json(500, { error: "envio_nao_configurado" });
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return json(401, { error: "sem_login" });
  let token = "";
  try {
    token = String((await req.json()).token ?? "");
  } catch (_) {
    return json(400, { error: "pedido_invalido" });
  }
  if (token.length < 16 || token.length > 200) return json(400, { error: "pedido_invalido" });

  const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await user.rpc("convite_para_envio", { p_token: token });
  if (error) return json(403, { error: String(error.message || "negado") });
  const c = Array.isArray(data) ? data[0] : null;
  if (!c) return json(403, { error: "convite_invalido" });

  const link = `${SISTEMA}/?convite=${encodeURIComponent(token)}`;
  const dias = Math.max(1, Math.ceil((new Date(c.expira_em).getTime() - Date.now()) / 86400000));
  const empresa = String(c.empresa_nome ?? "sua empresa");
  const papel = PAPEL[c.papel] ?? "usuário";
  const assunto = `${PREFIXO}Convite para ${empresa}`;
  const texto =
    `Você foi convidado para ${empresa}, como ${papel}.\n\nCrie sua senha e entre pelo link (vale ${dias} dias e só funciona uma vez):\n${link}\n\n` +
    `Use este mesmo e-mail ao criar a conta. Se você não esperava este convite, pode ignorar esta mensagem.`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;background:#FBFAF7;padding:32px 16px;color:#1F2A27"><div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E6E1D8;border-radius:12px;padding:32px">` +
    `<p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;color:#6B7570">VOCÊ FOI CONVIDADO</p>` +
    `<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;line-height:1.2">${esc(empresa)}</h1>` +
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#525D57">Você recebeu um convite como <b>${esc(papel)}</b>. Crie sua senha para entrar.</p>` +
    `<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#263029;color:#fff;text-decoration:none;border-radius:10px;padding:14px 24px;font-size:15px">Criar conta e entrar</a></p>` +
    `<p style="margin:0;font-size:13px;line-height:1.5;color:#6B7570">O link vale ${dias} dias e só funciona uma vez. Use este mesmo e-mail ao criar a conta. Se você não esperava este convite, ignore esta mensagem.</p>` +
    `</div></div>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND}`, "content-type": "application/json", "Idempotency-Key": `convite-${c.id}-${c.envio}` },
    body: JSON.stringify({
      from: REMETENTE,
      to: [c.email],
      subject: assunto,
      html,
      text: texto,
      ...(RESPONDER_PARA ? { reply_to: RESPONDER_PARA } : {}),
    }),
  });
  if (!r.ok) {
    console.error("resend", r.status);
    return json(502, { error: "falha_no_envio" });
  }
  return json(200, { ok: true, para: c.email });
});
