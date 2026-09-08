-- ============================================================================
-- Dois acolhedores novos no cadastro canônico: Renan e Fabrício
--
-- A tabela `acolhedores` (criada em 30/07/2026) é o cadastro que o front usa
-- para o filtro por pessoa da lista do board de acolhimento e para resolver
-- avatar/nome canônico a partir de `leads.acolhedor` (texto livre). Quem não
-- está aqui não aparece no filtro e cai no avatar de iniciais.
--
-- Renan: o perfil dele já existe (profiles.full_name = 'Renan Vieira Mendes',
-- user cf308900) e 4 leads do board Trabalhista já estão no nome dele — mas ele
-- nunca entrou nem nesta tabela nem na lista do seletor, então a atribuição só
-- podia ter vindo de importação/SQL, nunca da tela. Nome canônico é o do
-- perfil, justamente para não criar uma segunda grafia no mesmo campo; o
-- 'Renan Mendes' curto entra como alias.
--
-- Fabrício: não existia em lugar nenhum (nem profiles, nem leads, nem
-- instância de WhatsApp). Entra só como acolhedor; conta de acesso ao sistema
-- é outro fluxo (convite pela tela Equipe).
--
-- Espelha src/lib/trabalhistaAcolhedores.ts e src/lib/acolhedorPhotos.ts.
--
-- Aplicada no Externo (kmedldlepwiityjsdahz) via PostgREST em 08/09/2026.
-- Verificado pós-aplicação: 201 nas 2 linhas, tabela com 8 acolhedores ativos.
--
-- Rollback:
--   delete from public.acolhedores
--    where nome_canonico in ('Renan Vieira Mendes', 'Fabrício Figueiredo');
-- ============================================================================

insert into public.acolhedores (nome_canonico, aliases) values
  ('Renan Vieira Mendes', array['Renan Mendes', 'Renan']),
  ('Fabrício Figueiredo', array['Fabricio Figueiredo', 'Fabrício', 'Fabricio'])
on conflict (nome_canonico) do nothing;
