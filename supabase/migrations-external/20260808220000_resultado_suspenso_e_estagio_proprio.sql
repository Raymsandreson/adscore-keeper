-- =============================================================================
-- Suspensão vira RESULTADO, e o resultado ganha estágio financeiro próprio.
--
-- Duas coisas que só apareceram quando o usuário disse "suspensão é um resultado
-- atual, né, antes status?" — e a conferência do que isso produzia expôs um erro
-- meu de arquitetura.
--
-- -----------------------------------------------------------------------------
-- 1. O ESTÁGIO FINANCEIRO NÃO PODE VIR SÓ DO MARCO
-- -----------------------------------------------------------------------------
-- Eu tinha proposto a ponte resultado → marco → estágio, com o estágio morando
-- só em pop_marcos. Ao listar o que isso produzia:
--
--   Deferido    → transito_julgado → CONDENACAO
--   Indeferido  → transito_julgado → CONDENACAO   ← errado
--   Extinto     → transito_julgado → CONDENACAO   ← errado
--   Desistido   → transito_julgado → CONDENACAO   ← errado
--
-- Quatro resultados compartilham o MESMO marco. O marco é de fato o mesmo — o
-- processo transitou em julgado nos quatro casos — mas no primeiro o recebível
-- vira condenação e nos outros três ele MORRE. Estágio derivado só do marco
-- carimbaria R$ de condenação em processo perdido.
--
-- Correção: o resultado pode declarar `estagio`, e quando declara vence o do
-- marco. Precedência: resultado.estagio ?? marco.estagio_financeiro_sugerido.
--
-- -----------------------------------------------------------------------------
-- 2. "Acordo" apontava para chave que não existe mais
-- -----------------------------------------------------------------------------
-- settings.resultados guardava marco = 'acordo'; na régua nova a chave é
-- 'acordo_homologado'. Silencioso: nenhum erro, só um estágio que nunca resolve.
-- É o risco de guardar chave de marco como texto solto em jsonb.
--
-- -----------------------------------------------------------------------------
-- 3. Suspenso HERDA o estágio, e isso é o certo
-- -----------------------------------------------------------------------------
-- Não recebe estágio próprio nem tem marco com estágio. Processo suspenso não
-- muda onde o dinheiro está — ele para no lugar. Herdar o estágio do último
-- marco preenchido é exatamente o comportamento desejado.
-- =============================================================================

-- Suspenso entra como resultado (situação atual, não desfecho — por isso não é
-- marcado como esperado).
update public.kanban_boards
set settings = jsonb_set(settings, '{resultados}',
  (settings->'resultados') || jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Suspenso', 'marco', 'suspensao')
  ))
where name = 'Trabalhistas judicial — marcos (rascunho)'
  and not exists (
    select 1 from jsonb_array_elements(settings->'resultados') r
     where r->>'label' = 'Suspenso'
  );

update public.kanban_boards k
set settings = jsonb_set(k.settings, '{resultados}', (
  select jsonb_agg(
    case
      when r->>'label' = 'Acordo'
        then jsonb_set(r, '{marco}', '"acordo_homologado"')
      when r->>'label' in ('Indeferido','Extinto sem resolução de mérito','Desistido')
        then r || jsonb_build_object('estagio', 'INDEFERIDO')
      else r
    end order by ord)
  from jsonb_array_elements(k.settings->'resultados') with ordinality x(r, ord)
))
where k.name = 'Trabalhistas judicial — marcos (rascunho)';

-- Conferência: nenhum resultado deve ficar com estágio errado.
--   select r->>'label',
--          coalesce(r->>'estagio',
--            (select estagio_financeiro_sugerido from pop_marcos pm
--              where pm.board_id=k.id and pm.chave = r->>'marco'),
--            '(herda)')
--     from kanban_boards k, jsonb_array_elements(k.settings->'resultados') r
--    where k.name = 'Trabalhistas judicial — marcos (rascunho)';
