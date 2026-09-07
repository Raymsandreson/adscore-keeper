-- =============================================================================
-- A leitura de peça passa a deixar registrado POR QUE falhou.
--
-- O QUE ESTAVA ACONTECENDO
-- 73 peças baixadas nunca viraram leitura. Nenhuma delas deixou rastro. Três
-- camadas de silêncio empilhadas:
--
--   1. `jm-ler-peca` devolve HTTP 200 em TODA falha, com {success:false} no
--      corpo. Do ponto de vista do banco, deu certo.
--   2. `jm_ler_documento` chama com `perform net.http_post(...)` — descarta a
--      resposta. Ninguém lê o corpo.
--   3. `jm_documentos` não tinha onde guardar erro de leitura. Só
--      `leitura_disparada_em`, que diz que saiu, nunca que chegou.
--
-- Resultado: o tick redispara a cada 24h, a leitura falha de novo, e isso se
-- repete desde 12/07 em algumas peças — pagando uma chamada de Gemini por
-- tentativa, sem ninguém saber. É o interfone que toca e ninguém atende: quem
-- aperta o botão conclui que atenderam.
--
-- O MOTIVO REAL, capturado do net._http_response antes de expirar (TTL ~6h):
--   {"success":false,"documento_id":30,"error":"leitura: Expected ',' or '}'
--    after property value in JSON at position 6796"}
--   {"success":false,"documento_id":110,"error":"leitura: Unterminated string
--    in JSON at position 818"}
-- O JSON que o Gemini devolve chega cortado e o JSON.parse estoura.
--
-- POR QUE NÃO BASTA "AUMENTAR O maxOutputTokens": já está em 8192, e corte na
-- posição 818 são ~200 tokens. Há peça de UMA página entre as travadas. Não é
-- teto de tamanho. As duas coisas que diriam qual é a causa — `finishReason` e
-- o número de `parts` da resposta — eram justamente as que o código descartava.
--
-- O QUE ESTA MIGRATION FAZ
--   * três colunas em jm_documentos para o erro ter onde morar;
--   * o tick passa a CONTAR as tentativas (antes só carimbava a última);
--   * uma view que mostra o que está travado, com motivo e quantas tentativas.
--
-- O QUE ELA NÃO FAZ, de propósito: não põe teto de tentativas. Capar antes de
-- saber a causa parqueia para sempre peça que voltaria a ler depois do
-- conserto. O teto se decide depois, com o motivo na mão.
--
-- Junto vai o deploy da jm-ler-peca que ESCREVE nessas colunas — migration
-- sozinha não enche coluna nenhuma.
--
-- ROLLBACK:
--   drop view if exists public.vw_jm_leitura_travada;
--   alter table public.jm_documentos
--     drop column if exists leitura_erro,
--     drop column if exists leitura_erro_em,
--     drop column if exists leitura_tentativas;
--   (e redeploy da versão anterior da jm-ler-peca)
-- =============================================================================

alter table public.jm_documentos
  add column if not exists leitura_erro       text,
  add column if not exists leitura_erro_em    timestamptz,
  add column if not exists leitura_tentativas integer not null default 0;

comment on column public.jm_documentos.leitura_erro is
  'Motivo da ULTIMA falha de leitura, escrito pela jm-ler-peca. Inclui o diagnostico da resposta do Gemini (finishReason, quantas parts, quantos chars e o fim do texto) — sem isso, "JSON cortado" nao diz se foi teto de token, corte de seguranca ou resposta partida. Volta a nulo quando a peca e lida.';
comment on column public.jm_documentos.leitura_erro_em is
  'Quando a ultima falha de leitura aconteceu.';
comment on column public.jm_documentos.leitura_tentativas is
  'Quantas vezes a leitura foi disparada. Cada tentativa paga uma chamada de Gemini; numero alto com leitura ausente e peca que falha sempre.';

-- Backfill honesto: as 73 travadas ja foram disparadas pelo menos uma vez.
-- Nao da para saber quantas (so a ultima ficava carimbada), entao marca 1 e
-- diz isso no proprio texto, em vez de inventar um numero.
update public.jm_documentos d
   set leitura_tentativas = 1,
       leitura_erro = 'motivo nao registrado — anterior a 07/09/2026, quando a coluna passou a existir',
       leitura_erro_em = d.leitura_disparada_em
 where d.storage_path is not null
   and d.oculta_em is null
   and d.leitura_disparada_em is not null
   and not exists (select 1 from public.jm_documento_leitura l where l.documento_id = d.id);

-- O tick passa a contar. Unica mudanca: leitura_tentativas + 1 no carimbo.
create or replace function public.jm_ler_documentos_tick(p_limite integer DEFAULT 10)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_disparadas integer := 0;
  r record;
begin
  for r in
    select d.id
      from public.jm_documentos d
     where d.storage_path is not null
       and d.oculta_em is null
       and (d.leitura_disparada_em is null or d.leitura_disparada_em < now() - interval '24 hours')
       and not exists (select 1 from public.jm_documento_leitura l where l.documento_id = d.id)
     order by d.stored_at desc nulls last, d.id desc
     limit greatest(1, least(coalesce(p_limite, 10), 50))
  loop
    update public.jm_documentos
       set leitura_disparada_em = now(),
           leitura_tentativas   = coalesce(leitura_tentativas, 0) + 1
     where id = r.id;
    perform public.jm_ler_documento(r.id);
    v_disparadas := v_disparadas + 1;
  end loop;
  return v_disparadas;
end $function$;

-- O que está travado, à vista. Sem uma lista, "registrar o erro" vira coluna
-- que ninguém olha — que é o mesmo silêncio de antes, com mais passos.
create or replace view public.vw_jm_leitura_travada as
select d.id                    as documento_id,
       d.processo_cnj,
       d.titulo,
       d.paginas,
       d.extensao,
       d.stored_at             as baixada_em,
       d.leitura_disparada_em  as ultima_tentativa,
       d.leitura_tentativas    as tentativas,
       d.leitura_erro          as motivo,
       (d.leitura_disparada_em + interval '24 hours') as proxima_tentativa
  from public.jm_documentos d
 where d.storage_path is not null
   and d.oculta_em is null
   and not exists (select 1 from public.jm_documento_leitura l where l.documento_id = d.id);

comment on view public.vw_jm_leitura_travada is
  'Pecas baixadas que nunca viraram leitura, com o motivo da ultima falha e quantas tentativas ja custaram. Em 07/09/2026 eram 73, a mais antiga parada desde 12/07.';
