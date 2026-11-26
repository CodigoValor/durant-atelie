-- Seed de HOMOLOGAÇÃO: loja Mark Bel (empresa), vendedor Ionaldo e catálogo de 97 artigos (tabelas 2026). Roda de novo sem duplicar.
do $$
declare v_emp uuid; v_loja uuid;
begin
  select id into v_emp from public.empresas where nome = 'Mark Bel' and fornece_tecido;
  if v_emp is null then insert into public.empresas (nome, vende_cliente_final, produz, fornece_tecido) values ('Mark Bel', false, false, true) returning id into v_emp; end if;
  select id into v_loja from public.tec_lojas where empresa_id = v_emp and lower(nome) = 'mark bel';
  if v_loja is null then insert into public.tec_lojas (empresa_id, nome, whatsapp) values (v_emp, 'Mark Bel', '5511982457810') returning id into v_loja; end if;
  if not exists (select 1 from public.tec_vendedores where empresa_id = v_emp and loja_id = v_loja) then
    insert into public.tec_vendedores (empresa_id, loja_id, nome, whatsapp, principal) values (v_emp, v_loja, 'Ionaldo (Nenê)', '5511964383980', true);
  end if;
  insert into public.tec_catalogo (empresa_id, loja_id, referencia, nome, composicao, largura_cm, cor, preco_metro, apelidos)
  select v_emp, v_loja, c.referencia, c.nome, c.composicao::text, c.largura_cm::numeric, c.cor::text, c.preco_metro, c.apelidos from (values
  ('3453','Super tropical',null,null,null,115,'{}'::text[]),
  ('7177','Gabardine',null,null,null,115,'{}'::text[]),
  ('7855','Cambraia',null,null,null,115,'{}'::text[]),
  ('8295/8685','Lã camurça',null,null,null,175,'{}'::text[]),
  ('6812','98% lã 2% elastano',null,null,null,235,'{}'::text[]),
  ('8589','96% lã 4% elastano',null,null,null,240,'{}'::text[]),
  ('4157','Gabardine lisa',null,null,null,230,'{}'::text[]),
  ('7005','Prunel',null,null,null,230,'{}'::text[]),
  ('8057','Twill',null,null,null,230,'{}'::text[]),
  ('8154','Twill',null,null,null,230,'{}'::text[]),
  ('8156','Cambraia',null,null,null,230,'{}'::text[]),
  ('8157','Gabardine mescla',null,null,null,230,'{}'::text[]),
  ('8256','S120 exclusivo',null,null,null,235,'{}'::text[]),
  ('110118','Jeans',null,null,null,250,'{}'::text[]),
  ('8296','Casimir',null,null,null,335,'{}'::text[]),
  ('8298','Superfine',null,null,null,335,'{}'::text[]),
  ('JACKET','Jacket super 100',null,null,null,250,'{}'::text[]),
  ('S100','S100 super 100',null,null,null,330,'{}'::text[]),
  ('PRIVILEGE','Privilege super 120',null,null,null,350,'{}'::text[]),
  ('DIAMOND','Diamond super 140',null,null,null,440,'{}'::text[]),
  ('2120','Fratelli',null,null,null,540,'{}'::text[]),
  ('2130','Fratelli',null,null,null,720,'{}'::text[]),
  ('2160','Fratelli',null,null,null,810,'{}'::text[]),
  ('2458','Guabello',null,null,null,540,'{}'::text[]),
  ('2728','Italiano',null,null,null,89.9,'{}'::text[]),
  ('2731','Fratelli',null,null,null,540,'{}'::text[]),
  ('3063','Fratelli',null,null,null,540,'{}'::text[]),
  ('3065','Angélico',null,null,null,540,'{}'::text[]),
  ('3067','Fratelli',null,null,null,540,'{}'::text[]),
  ('0101','Tricoline lisa 120/2','Algodão',null,null,130,'{}'::text[]),
  ('0102','Tricoline fio tinto 120/2','Algodão',null,null,130,'{}'::text[]),
  ('0104','Pin point ouro 80/2','Algodão',null,null,115,'{}'::text[]),
  ('0105','Pin point 60/2','Algodão',null,null,115,'{}'::text[]),
  ('1001','Tricoline lisa 80/2','Algodão',null,null,85,'{}'::text[]),
  ('1006','Tricoline fio tinto 80/2','Algodão',null,null,85,'{}'::text[]),
  ('1008','Tricoline fio tinto 80/2','Algodão',null,null,85,'{}'::text[]),
  ('1009','Tricoline prata 80/2','Algodão',null,null,115,'{}'::text[]),
  ('0106','Tricoline 80/2','Algodão',null,null,145,'{}'::text[]),
  ('0107','Tricoline 100/2','Algodão',null,null,145,'{}'::text[]),
  ('0108','Tricoline 160/2','Algodão',null,null,225,'{}'::text[]),
  ('0109','Tricoline 120/2','Algodão',null,null,205,'{}'::text[]),
  ('0110','Tricoline 70/2','Algodão',null,null,115,'{}'::text[]),
  ('0111','Tricoline com elastano 70/2','Algodão',null,null,115,'{}'::text[]),
  ('0112','Point 70/2','Algodão',null,null,115,'{}'::text[]),
  ('0117','Tricoline com elastano 70/2','Algodão',null,null,125,'{}'::text[]),
  ('0113','Tricoline 80/2','Algodão',null,null,105,'{}'::text[]),
  ('0114','Piquet malha 80/2','Algodão',null,null,100,'{}'::text[]),
  ('0115','Tricoline 120/2','Algodão',null,null,160,'{}'::text[]),
  ('0116','Tricoline com elastano','Algodão',null,null,105,'{}'::text[]),
  ('0119','Casuale','Algodão',null,null,140,'{}'::text[]),
  ('0120','Casuale com elastano','Algodão',null,null,140,'{}'::text[]),
  ('0121','Classic','Algodão',null,null,140,'{}'::text[]),
  ('1053','Cerimoniale','Algodão',null,null,130,'{}'::text[]),
  ('1054','Cerimoniale','Algodão',null,null,130,'{}'::text[]),
  ('1060','No iron 80/2','Algodão',null,null,140,'{}'::text[]),
  ('1086','Cambraia de linho','Algodão',null,null,185,'{}'::text[]),
  ('1120','Impermeável 120/2','Algodão',null,null,175,'{}'::text[]),
  ('1050','Tricoline com elastano','Algodão',null,null,80,'{}'::text[]),
  ('1051','Tricoline com elastano acetinado','Algodão',null,null,80,'{}'::text[]),
  ('1052','Tricoline','Algodão',null,null,80,'{}'::text[]),
  ('1057','Easy iron vol. I','Algodão',null,null,70,'{}'::text[]),
  ('1058','Easy iron vol. II','Algodão',null,null,60,'{}'::text[]),
  ('1059','Easy iron vol. III','Algodão',null,null,70,'{}'::text[]),
  ('1085','Cambraia de linho','Algodão',null,null,185,'{}'::text[]),
  ('1118','Essential charlotte 80','Algodão',null,null,80,'{}'::text[]),
  ('2457','Flanela','Algodão',null,null,60,'{}'::text[]),
  ('10120','Luxury 120','Algodão',null,null,140,'{}'::text[]),
  ('10140','Luxury 140','Algodão',null,null,180,'{}'::text[]),
  ('10170','Luxury 170','Algodão',null,null,230,'{}'::text[]),
  ('10200','Luxury 200','Algodão',null,null,320,'{}'::text[]),
  ('0302/2010','Micro fibra',null,null,null,60,'{}'::text[]),
  ('0314/2012','Oxford',null,null,null,40,'{}'::text[]),
  ('0348/2023','Gabardine',null,null,null,40,'{}'::text[]),
  ('0355/2001','Panamá',null,null,null,55,'{}'::text[]),
  ('1186','Valência com elastano',null,null,null,115,'{}'::text[]),
  ('1187','Valência com elastano',null,null,null,115,'{}'::text[]),
  ('2050','Sarja',null,null,null,90,'{}'::text[]),
  ('2051','Jeans lavado',null,null,null,90,'{}'::text[]),
  ('2055','Jeans leve',null,null,null,75,'{}'::text[]),
  ('2058','Veludo cotele',null,null,null,80,'{}'::text[]),
  ('2072','Sarja italiana',null,null,null,175,'{}'::text[]),
  ('2073','Sarja italiana',null,null,null,175,'{}'::text[]),
  ('2076','Sarja com elastano',null,null,null,100,'{}'::text[]),
  ('2078','Sarja com elastano',null,null,null,100,'{}'::text[]),
  ('2080','Linho misto',null,null,null,100,'{}'::text[]),
  ('2083','Cotton linho',null,null,null,175,'{}'::text[]),
  ('2085','Linho acetinado S129',null,null,null,270,'{}'::text[]),
  ('2086','Linho soft',null,null,null,160,'{}'::text[]),
  ('2087','Linho puro',null,null,null,170,'{}'::text[]),
  ('2156','Veludo',null,null,null,80,'{}'::text[]),
  ('2256','Veludo com elastano',null,null,null,85,'{}'::text[]),
  ('3739','Andorra',null,null,null,105,'{}'::text[]),
  ('6089','Barcelona',null,null,null,105,'{}'::text[]),
  ('6090','High tech',null,null,null,135,'{}'::text[]),
  ('6091','Madrid',null,null,null,115,'{}'::text[]),
  ('8650','Super 100',null,null,null,115,'{}'::text[]),
  ('9001','Linho',null,null,null,230,'{}'::text[])
  ) as c(referencia, nome, composicao, largura_cm, cor, preco_metro, apelidos)
  on conflict do nothing;
end $$;

-- Master (hd@henriquedurant.com): marcador + admin da Mark Bel, para alternar entre os sistemas.
insert into public.usuarios_master (user_id) select id from auth.users where email = 'hd@henriquedurant.com' on conflict do nothing;
insert into public.membros (empresa_id, user_id, papel)
select '8f8e58cd-18cd-4a6a-bffd-725315478a3d', id, 'admin' from auth.users where email = 'hd@henriquedurant.com'
on conflict do nothing;
