-- =============================================================================
-- LANÇAMENTOS — separar CONDENAÇÃO de "honorários a receber".
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- O PROBLEMA (Raym, 18/08/2026 — "quanto dá de honorários a receber? e outra,
-- está com data atrasada?"): a categoria "Honorários a receber" somava
-- R$ 5.816.833,01, dos quais R$ 4.997.428,78 com data no passado. Parecia
-- inadimplência gigante. Não era.
--
-- A CAUSA: 29 linhas (R$ 4.421.307,82, 15 processos, de 2021 a 2024) carregam a
-- data da DECISÃO, não de vencimento. A observação delas diz "Condenação em 1º
-- grau" / "Condenação em 2º grau", todas com `n_parcela = 1`. Ou seja: o juiz
-- fixou o valor e não há cronograma de pagamento nenhum.
--
-- Pela régua da carteira (skill whatsjud-fluxo-vocabulario) isso é CONDENAÇÃO —
-- valor certo, data incerta — e a régua é explícita: NUNCA junte CONDENAÇÃO com
-- A RECEBER na mesma coluna, porque superestima o descontável. Aqui inflava o
-- "a receber" em ~10x (R$ 5,8 mi contra os R$ 519 mil que têm cronograma) e
-- ainda fazia o app marcar tudo como vencido há anos.
--
-- O QUE MUDA: `categoria` de 'Honorários a receber' para 'Honorários condenação'
-- SOMENTE nas linhas com observação de condenação. 31 linhas (as 29 com data
-- passada mais 2 do CNJ 0016074-62.2016.5.16.0014 que estão SEM data nenhuma —
-- também "Condenação em 2º grau", n_parcela 1, R$ 300.028,14). Nada mais é
-- tocado — valor, data, pessoa e tipo ficam como estão (a data continua sendo a
-- da decisão, que é informação legítima; ela só deixa de ser lida como
-- vencimento).
--
-- Depois disto, o "honorários a receber" da carteira passa a valer:
--   a vencer   R$   519.376,09  (577 linhas, data futura)
--   vencido    R$   576.120,96  (71 linhas, data passada de verdade)
--   condenação R$ 4.721.335,96  (31 linhas, sem data de pagamento)
--
-- ATENÇÃO — a planilha NÃO tem esta categoria. Enquanto ela não tiver, uma
-- reimportação desfaria isto. O importador
-- (scripts/import-lancamentos-planilha.mjs) tem guarda para não sobrescrever, e
-- avisa quantas linhas segurou. O certo é criar a categoria na planilha também.
--
-- REVERSÃO:
--   update public.jm_lancamentos l
--      set categoria = b.categoria_anterior
--     from public.jm_lancamentos_categoria_backup_20260818 b
--    where b.id = l.id;
-- =============================================================================

create table if not exists public.jm_lancamentos_categoria_backup_20260818 as
select id, categoria as categoria_anterior, data, observacao, now() as salvo_em
from public.jm_lancamentos
where false;

alter table public.jm_lancamentos_categoria_backup_20260818 enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'jm_lancamentos_categoria_backup_20260818'
      and policyname = 'jm_lanc_cat_backup_auth_select'
  ) then
    create policy jm_lanc_cat_backup_auth_select
      on public.jm_lancamentos_categoria_backup_20260818
      for select to authenticated using (true);
  end if;
end $$;

insert into public.jm_lancamentos_categoria_backup_20260818
  (id, categoria_anterior, data, observacao, salvo_em)
select id, categoria, data, observacao, now()
from public.jm_lancamentos
where translate(lower(categoria), 'áàâãéêíóôõúç', 'aaaaeeiooouc') = 'honorarios a receber'
  and observacao ilike '%condena%';

update public.jm_lancamentos
   set categoria = 'Honorários condenação'
 where translate(lower(categoria), 'áàâãéêíóôõúç', 'aaaaeeiooouc') = 'honorarios a receber'
   and observacao ilike '%condena%';

comment on table public.jm_lancamentos_categoria_backup_20260818 is
  'Backup da categoria antes de separar CONDENACAO de "honorarios a receber" (18/08/2026). Guardar ate a planilha ganhar a categoria "Honorarios condenacao"; depois pode apagar.';
