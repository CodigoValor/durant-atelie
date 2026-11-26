-- Usar apenas com as identidades sintéticas do ensaio descartável.
begin;
do $$
begin
  if (select count(*) from public.reg where id = 'recuperacao-1') <> 2
     or (select count(*) from public.audit_log where reg_id = 'recuperacao-1') <> 2
     or (select count(*) from auth.users where email like '%@example.test') <> 3
     or (select count(*) from public.membros where empresa_id in (
       '55000000-0000-0000-0000-000000000002', '55000000-0000-0000-0000-000000000004'
     )) <> 3 then
    raise exception 'Integridade dos dados sintéticos ou da auditoria';
  end if;
  if has_table_privilege('anon', 'public.reg', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.reg'::regclass) then
    raise exception 'Controle de acesso da tabela reg';
  end if;
end $$;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.sub', '55000000-0000-0000-0000-000000000001', true);
  if (select array_agg(j::jsonb ->> 'origem') from public.reg where id = 'recuperacao-1')
       is distinct from array['A']
     or (select count(*) from public.audit_log where reg_id = 'recuperacao-1') <> 1 then
    raise exception 'Isolamento de registros e auditoria do administrador A';
  end if;

  perform set_config('request.jwt.sub', '55000000-0000-0000-0000-000000000003', true);
  if (select array_agg(j::jsonb ->> 'origem') from public.reg where id = 'recuperacao-1')
       is distinct from array['B']
     or (select count(*) from public.audit_log where reg_id = 'recuperacao-1') <> 1 then
    raise exception 'Isolamento de registros e auditoria do administrador B';
  end if;

  perform set_config('request.jwt.sub', '55000000-0000-0000-0000-000000000005', true);
  if (select array_agg(j::jsonb ->> 'origem') from public.reg where id = 'recuperacao-1')
       is distinct from array['A']
     or exists (select 1 from public.audit_log where reg_id = 'recuperacao-1') then
    raise exception 'Visibilidade de registros e auditoria do usuário comum';
  end if;

  perform set_config('request.jwt.sub', '55000000-0000-0000-0000-000000000006', true);
  if exists (select 1 from public.reg) or exists (select 1 from public.audit_log) then
    raise exception 'Visibilidade de registros e auditoria sem vínculo';
  end if;
end $$;
rollback;
