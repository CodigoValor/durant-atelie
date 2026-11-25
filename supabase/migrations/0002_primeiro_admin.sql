-- Rode DEPOIS de criar o usuário em Authentication > Users (e-mail hd@henriquedurant.com, "Auto Confirm User" marcado).
-- Liga esse usuário à empresa como administrador.
insert into public.membros (user_id, empresa_id, papel)
select u.id, e.id, 'admin'
from auth.users u
cross join public.empresas e
where lower(u.email) = 'hd@henriquedurant.com'
  and e.nome = 'Durant Alfaiataria'
on conflict (user_id, empresa_id) do update set papel = 'admin';

-- Conferência: deve mostrar 1 linha com papel = admin
select u.email, e.nome as empresa, m.papel
from public.membros m
join auth.users u on u.id = m.user_id
join public.empresas e on e.id = m.empresa_id;
