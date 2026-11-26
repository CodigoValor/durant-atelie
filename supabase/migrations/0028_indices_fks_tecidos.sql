-- Índices de apoio às chaves estrangeiras sinalizadas pelo Advisor de homologação.
create index if not exists tec_loja_clientes_user_idx on public.tec_loja_clientes (user_id);
create index if not exists tec_itens_catalogo_loja_idx on public.tec_pedido_itens (catalogo_loja_id);
create index if not exists tec_itens_empresa_catalogo_idx on public.tec_pedido_itens (empresa_id, catalogo_id);
create index if not exists tec_itens_empresa_destino_idx on public.tec_pedido_itens (empresa_id, destino_id);
create index if not exists tec_pedidos_empresa_loja_idx on public.tec_pedidos (empresa_id, loja_id);
create index if not exists tec_pedidos_empresa_vendedor_idx on public.tec_pedidos (empresa_id, vendedor_id);
