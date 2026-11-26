-- Alinhavo — copiar os dados de PRODUÇÃO para a HOMOLOGAÇÃO com dados pessoais embaralhados.
-- >>> RODE SOMENTE NO SUPABASE DE HOMOLOGAÇÃO (azkvclwozhneyougtcbn). NUNCA em produção. <<<
--
-- Antes (passo a passo no chat):
--  A) Em PRODUÇÃO (só leitura): anote o id da empresa Durant (select id, nome from public.empresas;) e exporte a tabela reg em CSV (Table Editor > reg > Export).
--  B) Em HOMOLOGAÇÃO: crie a empresa-rascunho com o MESMO id (bloco 1 abaixo) e importe o CSV na tabela reg (Table Editor > reg > Import data from CSV).
--  C) Em HOMOLOGAÇÃO: troque COLE-AQUI-O-ID-DA-EMPRESA-DE-PRODUCAO pelo id anotado (2 vezes: bloco 1 e bloco 2) e rode o bloco 2.
--
-- O que o bloco 2 faz: apaga os dados de teste da empresa de destino (padrão: Durant, na homologação), move a cópia para ela, embaralha nome/CPF/telefone/e-mail/
-- nascimento/endereço dos clientes (em todos os documentos), tira as senhas guardadas e descarta cópias de segurança (bkp).
-- Trava de segurança: se o id informado for o da própria Durant deste banco (ou seja, se isto for a produção), o script para.

-- ===== BLOCO 1 (rode antes de importar o CSV) =====
insert into public.empresas (id, nome) values ('COLE-AQUI-O-ID-DA-EMPRESA-DE-PRODUCAO', 'Cópia de produção (rascunho)')
on conflict (id) do nothing;

-- ===== BLOCO 2 (rode depois de importar o CSV) =====
do $$
declare
  v_old uuid := 'COLE-AQUI-O-ID-DA-EMPRESA-DE-PRODUCAO';
  v_destino text := 'Durant Alfaiataria';     -- empresa da HOMOLOGAÇÃO que vai receber a cópia (ex.: 'HDA Produção' para testar parceiro)
  v_new uuid;
  v_n int; r record; v_fake text;
  v_campos text[] := array['cpf','cnpj','tel','tel2','telefone','whatsapp','email','nasc','empresa','cidade','uf','cep','end','endereco','rua','numero','bairro','compl','complemento','indicNome','historia','interesses','obs'];
  c text;
begin
  select id into v_new from public.empresas where nome = v_destino limit 1;
  if v_new is null then raise exception 'empresa % não encontrada neste banco', v_destino; end if;
  if v_old = v_new then raise exception 'PARE: o id informado é o da Durant deste banco. Isto parece ser a PRODUÇÃO. Nada foi alterado.'; end if;
  if not exists (select 1 from public.empresas where id = v_old) then raise exception 'empresa-rascunho não existe: rode o bloco 1 antes'; end if;
  if not exists (select 1 from public.reg where empresa_id = v_old) then raise exception 'não há linhas importadas com esse empresa_id: importe o CSV antes'; end if;

  delete from public.reg where empresa_id = v_old and k = 'bkp';                       -- cópias de segurança: não vão para a homologação
  delete from public.reg where empresa_id = v_new;                                     -- dados de teste antigos da Durant na homologação
  delete from public.contadores where empresa_id = v_new;                              -- numeração recalculada a partir da cópia

  -- 1) nomes: troca o nome real por "Cliente NNNN" em TODOS os documentos (pedidos, avisos, provas...)
  for r in select i, (j::jsonb ->> 'nome') as nome from public.reg where empresa_id = v_old and k = 'clientes' and j::jsonb ? 'nome' loop
    v_fake := 'Cliente ' || lpad(regexp_replace(r.i, '\D', '', 'g'), 4, '0');
    if length(btrim(coalesce(r.nome, ''))) >= 5 then
      update public.reg set j = replace(j, r.nome, v_fake) where empresa_id = v_old and position(r.nome in j) > 0;
    end if;
  end loop;

  -- 2) campos pessoais do cadastro de clientes
  for r in select id, j::jsonb as j from public.reg where empresa_id = v_old and k = 'clientes' loop
    v_fake := 'Cliente ' || lpad(regexp_replace(split_part(r.id, '~', 2), '\D', '', 'g'), 4, '0');
    foreach c in array v_campos loop
      if r.j ? c then r.j := jsonb_set(r.j, array[c], case when jsonb_typeof(r.j -> c) = 'array' then '[]'::jsonb when jsonb_typeof(r.j -> c) = 'boolean' then r.j -> c else '""'::jsonb end); end if;
    end loop;
    if r.j ? 'nome' then r.j := jsonb_set(r.j, '{nome}', to_jsonb(v_fake)); end if;
    update public.reg set j = r.j::text where empresa_id = v_old and id = r.id;
  end loop;

  -- 3) usuários: tira senhas (hash e salt) das configurações
  update public.reg set j = jsonb_set(j::jsonb, '{usuarios}', (select coalesce(jsonb_agg(u - 'hash' - 'salt'), '[]'::jsonb) from jsonb_array_elements(j::jsonb -> 'usuarios') u))::text
   where empresa_id = v_old and id = 'sing~cfg' and jsonb_typeof(j::jsonb -> 'usuarios') = 'array';

  -- 4) move a cópia para a Durant da homologação e apaga o rascunho
  insert into public.reg (empresa_id, id, k, i, n, j, atualizado_em)
    select v_new, id, k, i, n, j, atualizado_em from public.reg where empresa_id = v_old;
  delete from public.reg where empresa_id = v_old;
  delete from public.empresas where id = v_old;

  -- 5) conferência
  select count(*) into v_n from public.reg where empresa_id = v_new and k = 'clientes';
  raise notice 'Cópia concluída: % clientes embaralhados.', v_n;
end $$;

-- Conferência (deve mostrar nomes "Cliente 0001"... e nenhum CPF/telefone)
select (j::jsonb ->> 'nome') as nome, (j::jsonb ->> 'cpf') as cpf, (j::jsonb ->> 'tel') as tel
from public.reg r join public.empresas e on e.id = r.empresa_id
where r.k = 'clientes' and e.id <> '00000000-0000-0000-0000-000000000000' order by r.empresa_id, r.i limit 10;
