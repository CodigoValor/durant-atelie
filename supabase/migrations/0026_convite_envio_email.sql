-- 0026: envio do convite por e-mail (a função de borda "enviar-convite" chama convite_para_envio).
-- O link continua aparecendo na tela como alternativa. Aqui o servidor só entrega os dados do convite
-- a quem pode convidar (administrador da empresa ou da plataforma) e limita os envios por convite.

alter table public.convites add column if not exists envios integer not null default 0;
alter table public.convites add column if not exists ultimo_envio timestamptz;

create or replace function public.convite_para_envio(p_token text)
returns table (id uuid, envio integer, email text, empresa_nome text, papel text, expira_em timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_nome text;
begin
  select * into c from public.convites where token_hash = public._hash_token(p_token) for update;
  if not found or c.status <> 'pendente' or c.expira_em < now() then raise exception 'convite inválido ou expirado'; end if;
  if not coalesce((c.empresa_id is not null and public.papel_em(c.empresa_id) = 'admin')
       or (c.empresa_id is null and public._eh_plataforma()), false) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if c.envios >= 3 then raise exception 'limite de 3 e-mails por convite; gere um novo link'; end if;
  if c.ultimo_envio is not null and c.ultimo_envio > now() - interval '1 minute' then
    raise exception 'aguarde 1 minuto para reenviar';
  end if;
  update public.convites set envios = envios + 1, ultimo_envio = now() where convites.id = c.id;
  select coalesce(c.empresa_nome, e.nome) into v_nome from (select 1) x left join public.empresas e on e.id = c.empresa_id;
  perform public._audit_acao(c.empresa_id, 'update', 'convite', c.id::text, jsonb_build_object('email_enviado_para', c.email, 'envio', c.envios + 1));
  return query select c.id, c.envios + 1, c.email, v_nome, c.papel, c.expira_em;
end $$;

revoke all on function public.convite_para_envio(text) from public, anon;
grant execute on function public.convite_para_envio(text) to authenticated;

-- Correção de segurança: em cancelar_convite, quem não pertencia à empresa (papel nulo) passava na
-- checagem por causa da lógica de três valores do SQL (not null = null). Agora o nulo vale "sem permissão".
create or replace function public.cancelar_convite(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites;
begin
  select * into c from public.convites where id = p_id for update;
  if not found then raise exception 'convite não encontrado'; end if;
  if not coalesce((c.empresa_id is not null and public.papel_em(c.empresa_id) = 'admin')
       or (c.empresa_id is null and public._eh_plataforma()), false) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if c.status <> 'pendente' then raise exception 'este convite não está pendente'; end if;
  update public.convites set status = 'cancelado' where id = p_id;
  perform public._audit_acao(c.empresa_id, 'update', 'convite', p_id::text, jsonb_build_object('status', 'cancelado'));
end $$;
revoke all on function public.cancelar_convite(uuid) from public, anon;
grant execute on function public.cancelar_convite(uuid) to authenticated;
