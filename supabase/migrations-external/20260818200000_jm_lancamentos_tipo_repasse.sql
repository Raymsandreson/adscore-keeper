-- =============================================================================
-- LANÇAMENTOS — TIPO ganha o valor REPASSE, e as linhas de terceiro migram.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- O PROBLEMA (Raym, 18/08/2026): "eu nao sei o q boto na parte do cliente e do
-- parceiro pq nao é entrada nem saída". Ele está certo — e a base mostra a
-- confusão: das 1.302 linhas de indenização (cota do cliente), 859 estão sem
-- tipo, 443 estão como ENTRADA, e 2 ele já tinha escrito "Repasse" à mão.
--
-- A CAUSA: a coluna TIPO estava respondendo duas perguntas ao mesmo tempo —
-- "para que lado o dinheiro andou" e "de quem é o dinheiro". Entrada/Saída só
-- respondem a primeira. A cota do cliente que cai na conta do escritório É uma
-- entrada de dinheiro, mas NÃO é receita: é dever de repasse.
--
-- A RÉGUA, daqui pra frente (espelha src/lib/lancamentoCategorias.ts):
--   ENTRADA  entrou e é NOSSO   honorário (recebido ou a receber), crédito
--                               comprado, adiantamento do FIDC
--   SAIDA    saiu e era NOSSO   custas, perícia, folha, imposto
--   REPASSE  dinheiro de TERCEIRO passando pela conta — cota do cliente e
--            repasse ao advogado parceiro. Não é receita nem despesa.
--
-- O QUE ESTA MIGRATION MUDA (medido em 18/08/2026, antes de rodar):
--   1.325 linhas viram REPASSE (indenização exceto comprada, + adv parceiro).
--         Dessas, 449 estavam como ENTRADA e 876 estavam sem tipo ou 'OUTRO'.
--      76 linhas viram ENTRADA (honorário e indenização comprada sem tipo).
--   Nenhuma linha de categoria ambígua (Movimentação conta, OUTROS) é tocada:
--   sem régua confiável, o certo é deixar como está.
--
-- NÃO altera valor, data, categoria nem pessoa — só a coluna `tipo`.
--
-- REVERSÃO (a tabela de backup guarda o tipo anterior de cada linha tocada):
--   update public.jm_lancamentos l
--      set tipo = b.tipo_anterior
--     from public.jm_lancamentos_tipo_backup_20260818 b
--    where b.id = l.id;
-- =============================================================================

-- Rota de fuga antes de mexer: o estado exato de quem for tocado.
create table if not exists public.jm_lancamentos_tipo_backup_20260818 as
select id, tipo as tipo_anterior, categoria, now() as salvo_em
from public.jm_lancamentos
where false;

alter table public.jm_lancamentos_tipo_backup_20260818 enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'jm_lancamentos_tipo_backup_20260818'
      and policyname = 'jm_lanc_tipo_backup_auth_select'
  ) then
    create policy jm_lanc_tipo_backup_auth_select
      on public.jm_lancamentos_tipo_backup_20260818
      for select to authenticated using (true);
  end if;
end $$;

with alvo as (
  select id, tipo,
         translate(lower(categoria), 'áàâãéêíóôõúç', 'aaaaeeiooouc') as cat
  from public.jm_lancamentos
),
novo as (
  select id, tipo as tipo_anterior,
    case
      -- Terceiro passando pela conta: cota do cliente e repasse ao parceiro.
      when cat like '%parceiro%'                                  then 'REPASSE'
      when cat like '%indeniza%' and cat not like '%comprad%'      then 'REPASSE'
      when cat like '%cota%'                                       then 'REPASSE'
      -- Nosso. "Comprada" antes de honorário não importa aqui: são exclusivos.
      when cat like '%comprad%'                                    then 'ENTRADA'
      when cat like '%honorari%'                                   then 'ENTRADA'
    end as tipo_novo
  from alvo
)
insert into public.jm_lancamentos_tipo_backup_20260818 (id, tipo_anterior, categoria, salvo_em)
select n.id, n.tipo_anterior, l.categoria, now()
from novo n
join public.jm_lancamentos l on l.id = n.id
where n.tipo_novo is not null
  and n.tipo_novo is distinct from n.tipo_anterior;

update public.jm_lancamentos l
   set tipo = b.tipo_novo
  from (
    select id,
      case
        when cat like '%parceiro%'                              then 'REPASSE'
        when cat like '%indeniza%' and cat not like '%comprad%'  then 'REPASSE'
        when cat like '%cota%'                                   then 'REPASSE'
        when cat like '%comprad%'                                then 'ENTRADA'
        when cat like '%honorari%'                               then 'ENTRADA'
      end as tipo_novo
    from (
      select id, translate(lower(categoria), 'áàâãéêíóôõúç', 'aaaaeeiooouc') as cat
      from public.jm_lancamentos
    ) x
  ) b
 where b.id = l.id
   and b.tipo_novo is not null
   and b.tipo_novo is distinct from l.tipo;

comment on table public.jm_lancamentos_tipo_backup_20260818 is
  'Backup do jm_lancamentos.tipo antes da migracao para REPASSE (18/08/2026). Guardar ate a proxima reimportacao da planilha confirmar a regua nova; depois pode apagar.';

comment on column public.jm_lancamentos.tipo is
  'Para onde o dinheiro andou: ENTRADA (entrou e e nosso), SAIDA (saiu e era nosso), REPASSE (de terceiro passando pela conta — cota do cliente, repasse ao advogado parceiro). De quem e o dinheiro sai da CATEGORIA, nao daqui — ver src/lib/lancamentoCategorias.ts.';
