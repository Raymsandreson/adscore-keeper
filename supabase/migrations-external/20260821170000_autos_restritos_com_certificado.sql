-- =============================================================================
-- OS AUTOS RESTRITOS ENTRAM: o certificado digital deixa de ser enfeite
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- ATENÇÃO — DUAS COISAS DAQUI FORAM CORRIGIDAS NO MESMO DIA, leia junto com
-- 20260821190000 (a colheita passou a ADOTAR a linha legada em vez de duplicar)
-- e 20260821200000 (o modo AUTOS deixou de ser default e virou opt-in; a
-- jm_esc_reabrir(p_limit,p_modo) definida aqui foi REMOVIDA por colidir com a
-- jm_esc_reabrir() preexistente). O que vale hoje é o que está naquelas duas.
--
-- O QUE ESTAVA ERRADO (medido em 21/08/2026):
--   jm_documentos ... 4.261 peças, 100% com tipo='PUBLICO', origem='escavador_publico'
--   O certificado PDPJ está cadastrado no Escavador e vale para 165 sistemas,
--   mas jm_esc_disparar pedia `documentos_publicos=1` — e o modo público NUNCA
--   devolve peça restrita. O marco de Pagamento do 0016527-69.2021.5.16.0018
--   diz "Comprovante de transferência | Documento Diverso (RESTRITO)" e o
--   arquivo nunca foi buscado, porque nunca foi pedido.
--
--   Confirmado contra a API antes de mudar qualquer coisa: um GET direto em
--   /processos/numero_cnj/{cnj}/autos devolve 422 "Você não tem permissão para
--   acessar os autos desse processo. Faça uma solicitação na rota de atualizar
--   o processo, passando as credenciais de acesso." Custo: zero crédito.
--
-- O QUE MUDA (contrato da API v2, do openapi.json):
--   solicitar-atualizacao aceita `autos=1` + `utilizar_certificado=1`, e
--   `autos` NÃO PODE vir junto com `documentos_publicos`. Depois da atualização
--   concluída, GET /autos devolve públicos E restritos, paginado (links.next).
--
-- POR QUE O MODO PÚBLICO CONTINUA EXISTINDO: nem todo tribunal aceita o
-- certificado, e a própria API avisa que não cobre tribunal com usuário+senha
-- MAIS 2FA. Trocar cegamente para autos perderia o documento público que hoje
-- chega. Então a solicitação nasce em modo AUTOS e, se o Escavador recusar por
-- credencial, jm_esc_confirmar REABRE a mesma linha em modo PUBLICOS — o
-- processo cai para o que dá para pegar em vez de ficar sem nada.
--
-- CHAVE NATURAL AMPLIADA: (cnj, titulo, data) colapsava dois "Despacho" do
-- mesmo dia — tolerável no acervo público (peça por movimento), não nos autos
-- (dezenas de peças com o mesmo título). Entra o id do documento no Escavador
-- como quarta coluna; nas 4.261 linhas antigas ele é NULL -> coalesce 0 ->
-- dedup idêntica à de antes. Nada muda para quem já está gravado.
--
-- CUSTO: `autos` é cobrado por processo pelo Escavador (preço na tabela deles,
-- diferente dos R$ 0,20 do modo público). Como antes, NÃO existe cron de
-- reabertura: a varredura só acontece quando alguém chamar jm_esc_reabrir().
--
-- REVERSÃO:
--   jm_esc_disparar/jm_esc_confirmar/jm_esc_colher_docs voltam ao corpo de
--   20260811163000_jm_esc_rotina.sql + 20260817200000 (colher);
--   drop function public.jm_documentos_ingerir(text, jsonb);
--   drop function public.jm_esc_reabrir(integer);
--   alter table jm_esc_solicitacoes drop column modo;
--   (as colunas novas de jm_documentos podem ficar — são aditivas)
-- =============================================================================

-- ── 1. jm_documentos guarda o que os autos trazem a mais ────────────────────
alter table public.jm_documentos
  add column if not exists escavador_documento_id bigint,
  add column if not exists data_hora timestamptz,
  add column if not exists extensao text,
  add column if not exists paginas integer;

comment on column public.jm_documentos.escavador_documento_id is
  'id do documento no Escavador. NULL nas linhas do acervo publico antigo.';
comment on column public.jm_documentos.data_hora is
  'Data/hora completa da peca (autos devolve timestamp; documentos-publicos so a data).';

drop index if exists public.jm_documentos_natural_uk;
create unique index jm_documentos_natural_uk
  on public.jm_documentos (
    processo_cnj,
    (coalesce(titulo, '')),
    (coalesce(data_documento, '1900-01-01'::date)),
    (coalesce(escavador_documento_id, 0))
  );

-- ── 2. modo da solicitação ──────────────────────────────────────────────────
alter table public.jm_esc_solicitacoes
  add column if not exists modo text not null default 'AUTOS';

alter table public.jm_esc_solicitacoes drop constraint if exists jm_esc_solicitacoes_modo_check;
alter table public.jm_esc_solicitacoes
  add constraint jm_esc_solicitacoes_modo_check check (modo in ('AUTOS','PUBLICOS'));

comment on column public.jm_esc_solicitacoes.modo is
  'AUTOS = pede autos completos com certificado. PUBLICOS = fallback quando o tribunal recusa a credencial.';

-- ── 3. gravação das peças, chamada pela edge function esc-autos ─────────────
create or replace function public.jm_documentos_ingerir(p_cnj text, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_novos int := 0; v_total int := 0;
begin
  if p_cnj is null or jsonb_typeof(p_itens) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'ENTRADA_INVALIDA');
  end if;

  with itens as (
    -- distinct on resolve o duplicado DENTRO do payload; sem ele o ON CONFLICT
    -- estoura com "cannot affect row a second time".
    select distinct on (titulo, data_documento, esc_id)
           titulo, tipo, data_documento, data_hora, link, origem, esc_id, extensao, paginas
    from (
      select nullif(d->>'titulo','')                       as titulo,
             coalesce(nullif(d->>'tipo',''), 'PUBLICO')    as tipo,
             nullif(left(d->>'data',10),'')::date          as data_documento,
             (nullif(d->>'data',''))::timestamptz          as data_hora,
             d->>'link'                                    as link,
             coalesce(nullif(d->>'origem',''), 'escavador_autos') as origem,
             nullif(d->>'id','')::bigint                   as esc_id,
             nullif(d->>'extensao','')                     as extensao,
             nullif(d->>'paginas','')::int                 as paginas
      from jsonb_array_elements(p_itens) d
    ) s
  ),
  gravados as (
    insert into public.jm_documentos
      (processo_cnj, titulo, tipo, data_documento, data_hora, link_api, origem,
       escavador_documento_id, extensao, paginas)
    select p_cnj, i.titulo, i.tipo, i.data_documento, i.data_hora, i.link, i.origem,
           i.esc_id, i.extensao, i.paginas
    from itens i
    on conflict (processo_cnj, (coalesce(titulo, '')), (coalesce(data_documento, '1900-01-01'::date)),
                 (coalesce(escavador_documento_id, 0)))
    -- o link do Escavador é token que expira: renovar destrava o arquivamento
    -- de quem falhou com 410. O storage_path NÃO é tocado.
    do update set link_api  = excluded.link_api,
                  tipo      = excluded.tipo,
                  data_hora = coalesce(excluded.data_hora, jm_documentos.data_hora),
                  extensao  = coalesce(excluded.extensao, jm_documentos.extensao),
                  paginas   = coalesce(excluded.paginas, jm_documentos.paginas),
                  storage_error = case when jm_documentos.storage_path is null
                                       then null else jm_documentos.storage_error end
    returning (xmax = 0) as inserido
  )
  select count(*) filter (where inserido), count(*) into v_novos, v_total from gravados;

  return jsonb_build_object('ok', true, 'cnj', p_cnj, 'novos', v_novos, 'processados', v_total);
end $function$;

comment on function public.jm_documentos_ingerir(text, jsonb) is
  'Grava as pecas devolvidas pelo Escavador (autos ou documentos-publicos). Idempotente pela chave natural + id do documento.';

revoke all on function public.jm_documentos_ingerir(text, jsonb) from public, anon, authenticated;

-- ── 4. disparo: autos com certificado, público como fallback ────────────────
create or replace function public.jm_esc_disparar(p_limit integer default 10)
returns integer language plpgsql as $function$
declare v_rec record; v_n int := 0; v_body jsonb;
begin
  for v_rec in
    select id, processo_cnj, modo from public.jm_esc_solicitacoes
    where status='A_ENVIAR' order by id limit p_limit
  loop
    -- autos e documentos_publicos sao mutuamente exclusivos no contrato da API.
    v_body := case when v_rec.modo = 'AUTOS'
      then jsonb_build_object('autos',1,'utilizar_certificado',1,'ignorar_atualizados',1)
      else jsonb_build_object('documentos_publicos',1,'ignorar_atualizados',1)
    end;
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('acao','solicitar','cnj',v_rec.processo_cnj,'body',v_body),
      timeout_milliseconds := 30000);
    update public.jm_esc_solicitacoes set status='ENVIANDO' where id=v_rec.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

-- ── 5. confirmação: casa pelo cnj ecoado e rebaixa para PUBLICOS ────────────
-- Antes casava por resposta->numero_cnj, que só existe no corpo de SUCESSO: a
-- solicitação que dava erro ficava ENVIANDO para sempre (9 linhas assim em
-- 21/08/2026). A esc-autos passou a ecoar 'cnj' em toda resposta.
create or replace function public.jm_esc_confirmar()
returns integer language plpgsql as $function$
declare v_n integer := 0;
begin
  with respostas as (
    select distinct on (cnj) cnj, ok, creditos, esc_id, esc_status, erro
    from (
      select
        x.content::jsonb->>'cnj'                                    as cnj,
        (x.content::jsonb->>'ok')::boolean                          as ok,
        (x.content::jsonb->>'creditos')                             as creditos,
        nullif(x.content::jsonb->'resposta'->>'id','')::bigint      as esc_id,
        x.content::jsonb->'resposta'->>'status'                     as esc_status,
        coalesce(x.content::jsonb->>'erro',
                 x.content::jsonb->'resposta'->>'message')          as erro,
        x.created
      from net._http_response x
      where x.created >= now() - interval '30 minutes'
        and left(ltrim(x.content), 1) = '{'
        and x.content::jsonb ? 'cnj'
    ) s
    where cnj is not null
    order by cnj, created desc
  ),
  aplicar as (
    update public.jm_esc_solicitacoes s
       set status = case
             -- credencial recusada: nao adianta insistir em AUTOS, cai pro publico
             when r.ok is not true and s.modo = 'AUTOS'
              and coalesce(r.erro,'') ~* '(permiss|credencia|certificad|autentica|login)'
                                                                  then 'A_ENVIAR'
             when r.ok and r.esc_status in ('PENDENTE','SUCESSO') then 'PENDENTE'
             when coalesce(r.erro,'') ilike '%saldo%'             then 'BLOQUEADO_SALDO'
             when r.ok is not true                                then 'ERRO'
             else s.status
           end,
           modo = case
             when r.ok is not true and s.modo = 'AUTOS'
              and coalesce(r.erro,'') ~* '(permiss|credencia|certificad|autentica|login)'
             then 'PUBLICOS' else s.modo
           end,
           escavador_id = coalesce(r.esc_id, s.escavador_id),
           creditos     = coalesce(nullif(r.creditos,'')::int, s.creditos),
           motivo_erro  = r.erro
      from respostas r
     where s.processo_cnj = r.cnj and s.status = 'ENVIANDO'
    returning 1
  )
  select count(*) into v_n from aplicar;
  return v_n;
end $function$;

comment on function public.jm_esc_confirmar() is
  'ENVIANDO -> PENDENTE (ou A_ENVIAR em modo PUBLICOS quando o tribunal recusa a credencial). O Escavador nao manda callback.';

-- ── 6. colheita: a edge function grava e fecha a solicitação ────────────────
-- Some a leitura de net._http_response para inserir documento: a resposta dos
-- autos é paginada e passa longe do limite de tamanho que aquele caminho
-- aguentava. Agora esc-autos pagina, chama jm_documentos_ingerir e marca
-- SUCESSO com service role.
create or replace function public.jm_esc_colher_docs()
returns integer language plpgsql as $function$
declare v_rec record; v_n int := 0;
begin
  for v_rec in
    select processo_cnj, modo from public.jm_esc_solicitacoes
    where status='PENDENTE' order by id limit 15
  loop
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('acao', case when v_rec.modo='AUTOS' then 'autos' else 'docs' end,
                                 'cnj', v_rec.processo_cnj),
      timeout_milliseconds := 60000);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

-- ── 7. reabertura manual (sem cron, de propósito — a conta é do usuário) ────
create or replace function public.jm_esc_reabrir(p_limit integer default 0, p_modo text default 'AUTOS')
returns integer language plpgsql as $function$
declare v_n int;
begin
  with alvo as (
    select id from public.jm_esc_solicitacoes
    where status in ('SUCESSO','ERRO')
    order by coalesce(concluido_em, criado_em)
    limit case when p_limit > 0 then p_limit else 100000 end
  ), upd as (
    update public.jm_esc_solicitacoes s
       set status='A_ENVIAR', modo=p_modo, motivo_erro=null, concluido_em=null
      from alvo a where a.id = s.id returning 1
  ) select count(*) into v_n from upd;
  return v_n;
end $function$;

comment on function public.jm_esc_reabrir(integer, text) is
  'Recoloca solicitacoes na fila. Cada processo reaberto e um processo COBRADO na proxima rotina — por isso e chamada manual, nunca cron.';
