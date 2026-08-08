-- =============================================================================
-- FONTE DOS MARCOS POR POP
--
-- Pedido do usuário (08/08/2026): "é preciso resolver o problema de consultar
-- processo adm pelo Escavador, então cada POP deveria cadastrar a fonte dos
-- marcos daquele POP".
--
-- É a raiz do 422. O painel do Escavador mostrava as 5 últimas requisições
-- falhando em /processos/numero_cnj/{X}/movimentacoes com X = 111652461,
-- 2085735681… — requerimentos do INSS mandados para o endpoint judicial.
-- A guarda em sync-process-compromissos (deploy v15) para a sangria; esta tabela
-- ataca a causa: nada no sistema dizia de onde vêm os marcos de cada POP.
--
-- Medido antes da guarda: 255 chamadas inúteis por dia contra 33 legítimas.
--
-- UM POP PODE TER MAIS DE UMA FONTE, e é o caso comum: "POP - BPC -
-- Administrativo" tem 822 processos, dos quais 157 são requerimento do INSS
-- (fonte = e-mail) e 92 já judicializaram e têm CNJ (fonte = Escavador). Por
-- isso a chave é (board_id, fonte) com prioridade, não uma fonte por POP.
--
-- RESULTADO (1.803 processos vivos):
--   848  têm fonte que consegue consultar
--   908  sem número — são itens de checklist gravados em lead_processes, não
--        processos; cobrar régua deles é erro de leitura
--    27  número em formato que NENHUMA fonte do POP aceita (erro de cadastro,
--        vira fila de trabalho em vez de 422 diário)
--    20  POP não declarou fonte
--
-- REVERSÃO: drop view vw_pop_processo_fonte; drop function formato_do_numero;
--           drop table pop_fontes;
-- =============================================================================

create table if not exists public.pop_fontes (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.kanban_boards(id) on delete cascade,
  fonte        text not null check (fonte in ('datajud','escavador','email_inss','manual')),
  formato_numero text not null default 'cnj'
    check (formato_numero in ('cnj','requerimento_inss','nup','qualquer')),
  prioridade   smallint not null default 1,
  ativa        boolean not null default true,
  observacao   text,
  created_at   timestamptz not null default now(),
  constraint pop_fontes_unica unique (board_id, fonte)
);

alter table public.pop_fontes enable row level security;
drop policy if exists pop_fontes_all on public.pop_fontes;
create policy pop_fontes_all on public.pop_fontes
  for all to authenticated using (true) with check (true);

comment on table public.pop_fontes is
  'De onde vem o marco de cada POP e que forma de numero aquela fonte aceita. Um POP pode ter mais de uma fonte (administrativo que vira judicial).';

-- Espelha classificarNumeroProcesso() de src/lib/inssRegua.ts. Vive no banco
-- porque quem monta a fila de sync é SQL.
-- Dígito puro em requerimento não é preciosismo: dos 199 na faixa 7-12 dígitos,
-- os 5 com separador (datas, CNPJ) casam ZERO vezes no INSS.
create or replace function public.formato_do_numero(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = ''                                      then 'vazio'
    when btrim(p) ~ '^\d{7}-?\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'            then 'cnj'
    when btrim(p) ~ '^\d{5}\.\d{6}/\d{4}-\d{2}$'                         then 'nup'
    when btrim(p) ~ '^\d{7,12}$'                                         then 'requerimento_inss'
    else 'indefinido'
  end
$$;

create or replace view public.vw_pop_processo_fonte as
select
  p.id            as process_id,
  p.process_number,
  p.workflow_id,
  p.workflow_name,
  public.formato_do_numero(p.process_number) as formato,
  f.fonte,
  f.formato_numero as formato_esperado,
  f.prioridade,
  (f.fonte is not null
   and (f.formato_numero = 'qualquer'
        or f.formato_numero = public.formato_do_numero(p.process_number))) as consultavel
from public.lead_processes p
left join public.kanban_boards b
  on b.id::text = p.workflow_id
left join public.pop_fontes f
  on f.board_id = b.id and f.ativa
where p.deleted_at is null;

comment on view public.vw_pop_processo_fonte is
  'Fila de sync: qual fonte consultar por processo e se o numero esta no formato que aquela fonte aceita.';

-- Seed: fontes de cada POP existente, conferidas contra a distribuição real de
-- formatos de número de cada um (08/08/2026).
insert into public.pop_fontes (board_id, fonte, formato_numero, prioridade, observacao) values
 ('b436c043-3ddb-4900-8800-dc4063624816','datajud','cnj',1,'movimento por codigo TPU, historico completo'),
 ('b436c043-3ddb-4900-8800-dc4063624816','escavador','cnj',2,'texto da movimentacao e documentos dos autos'),
 ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded','datajud','cnj',1,null),
 ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded','escavador','cnj',2,null),
 ('91778d9c-d60e-461a-a763-839410166f00','datajud','cnj',1,null),
 ('91778d9c-d60e-461a-a763-839410166f00','escavador','cnj',2,null),
 ('8377ee1b-97a2-4777-9b51-3af9e630b3c6','email_inss','requerimento_inss',1,'requerimento em digitos puros; 157 processos'),
 ('8377ee1b-97a2-4777-9b51-3af9e630b3c6','escavador','cnj',2,'92 ja judicializaram e tem CNJ'),
 ('d5276364-f7a9-4c9f-a04b-8c634628ca98','email_inss','requerimento_inss',1,null),
 ('d5276364-f7a9-4c9f-a04b-8c634628ca98','escavador','cnj',2,null),
 ('b922f490-3600-4652-a629-5d63110501ca','email_inss','requerimento_inss',1,null),
 ('b922f490-3600-4652-a629-5d63110501ca','escavador','cnj',2,null),
 ('113305f3-38a1-41b1-ba1e-f55ac8391957','email_inss','requerimento_inss',1,null),
 ('113305f3-38a1-41b1-ba1e-f55ac8391957','escavador','cnj',2,null),
 ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c','email_inss','requerimento_inss',1,null),
 ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c','escavador','cnj',2,null),
 ('26a46944-abb8-4807-9a9e-0c7ed75cf881','manual','qualquer',1,'seguradora privada: nao ha fonte publica'),
 ('26a46944-abb8-4807-9a9e-0c7ed75cf881','escavador','cnj',2,'so os 3 que viraram acao judicial'),
 ('3768dda9-fdd5-4ace-9a40-bd0f01cab5bd','manual','qualquer',1,'inquerito policial nao tem regua nem fonte publica'),
 ('7450e942-c0c6-42fe-9c75-cadb435866b7','manual','qualquer',1,'NUP e protocolo da administracao federal: consulta no orgao')
on conflict (board_id, fonte) do nothing;
