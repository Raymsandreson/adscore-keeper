-- =============================================================================
-- O CNJ PASSA A DIZER O RAMO E A UF, E DUPLICATA PARA DE ENTRAR
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- MOTIVO 1 — o POP trabalhista não é trabalhista inteiro. Medido em 24/08/2026
-- no quadro "Trabalhistas judicial — marcos" (0bcd8be6): 1289 fichas, das quais
--   796 fichas / 786 CNJs na Justiça do Trabalho  (segmento 5)  <- o POP
--   215 fichas / 206 CNJs na Justiça Estadual     (segmento 8)
--    51 fichas /  49 CNJs na Justiça Federal      (segmento 4)
--   210 fichas sem número de processo nenhum
--    17 fichas com número quebrado (3 a 17 dígitos, não é CNJ)
-- O card anuncia 1289 porque conta ficha, não processo, e não olha o ramo.
--
-- `lead_processes.area` não serve de filtro: 1214 das 1289 estão com o campo
-- vazio, e as preenchidas vêm em quatro grafias ("Trabalhista", "TRABALHISTA",
-- "CIVEL", "Cível"). O número do processo é a única fonte confiável, e ele é
-- lei — Resolução CNJ 65/2008, NNNNNNN-DD.AAAA.J.TR.OOOO.
--
-- MOTIVO 2 — nada impede duplicata. A tabela só tem PK em `id`; não há índice
-- único em `process_number`. Resultado na base inteira: 1270 fichas com CNJ
-- válido para 1202 CNJs distintos — 48 CNJs repetidos, 68 fichas excedentes,
-- 21 CNJs em mais de um POP.
--
-- Nem toda repetição é erro. Em 10 CNJs as fichas irmãs pertencem a LEADS
-- DIFERENTES: é litisconsórcio (cônjuge, filho e pais no mesmo processo), e o
-- vocabulário FIDC diz que a unidade é (processo × cliente), não o processo.
-- Duplicata de verdade é o MESMO CNJ no MESMO lead — 23 grupos, 39 fichas
-- excedentes. É só isso que o gatilho barra.
--
-- O gatilho barra a entrada NOVA; as 39 de hoje continuam onde estão, para a
-- fila de conferência (`vw_lead_processes_duplicatas`) ser resolvida a mão.
-- Índice único físico só depois da fila zerada.
--
-- SEGURANÇA DE INGESTÃO: todo insert em lead_processes hoje é linha a linha
-- (AddProcessDialog, CasesPage, LegalCasesTab, whatsapp-command-processor,
-- zapsign-webhook). Não há carga em lote, então uma exceção derruba só a linha
-- duplicada, nunca um batch inteiro.
--
-- REVERSÃO:
--   drop trigger if exists lead_processes_sem_duplicata on public.lead_processes;
--   drop function if exists public.lead_processes_sem_duplicata();
--   drop view if exists public.vw_lead_processes_duplicatas;
--   drop function if exists public.cnj_uf(text), public.cnj_tribunal(text),
--     public.cnj_ramo(text), public.cnj_segmento(text), public.cnj_valido(text),
--     public.cnj_digitos(text);
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O CNJ decomposto. Tudo IMMUTABLE para poder virar índice depois.
-- -----------------------------------------------------------------------------

-- Só os dígitos. "0001561-29.2025.5.08.0101" e "00015612920255080101" são o
-- mesmo processo, e a base tem as duas grafias.
create or replace function public.cnj_digitos(p_numero text)
returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '')
$$;

comment on function public.cnj_digitos(text) is
  'Só os dígitos do número do processo. Null quando não sobra dígito nenhum.';

-- CNJ tem 20 dígitos, sempre. Menos que isso é cadastro pela metade.
create or replace function public.cnj_valido(p_numero text)
returns boolean language sql immutable parallel safe as $$
  select length(public.cnj_digitos(p_numero)) = 20
$$;

comment on function public.cnj_valido(text) is
  'true quando o número tem os 20 dígitos do padrão CNJ (Res. 65/2008).';

-- Posição 14 = J, o segmento de justiça.
create or replace function public.cnj_segmento(p_numero text)
returns text language sql immutable parallel safe as $$
  select case when public.cnj_valido(p_numero)
              then substring(public.cnj_digitos(p_numero) from 14 for 1) end
$$;

-- O ramo por extenso, incluindo os dois "não-ramos" que a tela precisa mostrar
-- separados: ficha sem número e ficha com número quebrado.
create or replace function public.cnj_ramo(p_numero text)
returns text language sql immutable parallel safe as $$
  select case
    when public.cnj_digitos(p_numero) is null then 'SEM_NUMERO'
    when not public.cnj_valido(p_numero)      then 'NUMERO_INVALIDO'
    else case public.cnj_segmento(p_numero)
      when '1' then 'STF'
      when '2' then 'CNJ'
      when '3' then 'STJ'
      when '4' then 'FEDERAL'
      when '5' then 'TRABALHISTA'
      when '6' then 'ELEITORAL'
      when '7' then 'MILITAR_UNIAO'
      when '8' then 'ESTADUAL'
      when '9' then 'MILITAR_ESTADUAL'
      else 'DESCONHECIDO'
    end
  end
$$;

comment on function public.cnj_ramo(text) is
  'Ramo da justiça pelo dígito J do CNJ. TRABALHISTA, ESTADUAL, FEDERAL, ... '
  'mais SEM_NUMERO e NUMERO_INVALIDO, que a tela mostra em linha própria.';

-- Na Justiça Estadual o TR é o próprio estado, em ordem alfabética (Res. 65,
-- anexo). Conferido contra a base: TJAL=02, TJBA=05, TJCE=06, TJGO=09, TJMA=10,
-- TJMT=11, TJMG=13, TJPA=14, TJPI=18, TJSP=26 — todos batem.
create or replace function public.cnj_uf_estadual(p_tr text)
returns text language sql immutable parallel safe as $$
  select case p_tr
    when '01' then 'AC' when '02' then 'AL' when '03' then 'AP' when '04' then 'AM'
    when '05' then 'BA' when '06' then 'CE' when '07' then 'DF' when '08' then 'ES'
    when '09' then 'GO' when '10' then 'MA' when '11' then 'MT' when '12' then 'MS'
    when '13' then 'MG' when '14' then 'PA' when '15' then 'PB' when '16' then 'PR'
    when '17' then 'PE' when '18' then 'PI' when '19' then 'RJ' when '20' then 'RN'
    when '21' then 'RS' when '22' then 'RO' when '23' then 'RR' when '24' then 'SC'
    when '25' then 'SE' when '26' then 'SP' when '27' then 'TO'
  end
$$;

-- Posições 15-16 = TR. A sigla do tribunal.
create or replace function public.cnj_tribunal(p_numero text)
returns text language sql immutable parallel safe as $$
  select case public.cnj_segmento(p_numero)
    when '5' then 'TRT-'  || ltrim(substring(public.cnj_digitos(p_numero) from 15 for 2), '0')
    when '4' then 'TRF-'  || ltrim(substring(public.cnj_digitos(p_numero) from 15 for 2), '0')
    when '8' then 'TJ'    || public.cnj_uf_estadual(substring(public.cnj_digitos(p_numero) from 15 for 2))
    when '1' then 'STF'
    when '3' then 'STJ'
    when '6' then 'TRE-'  || public.cnj_uf_estadual(substring(public.cnj_digitos(p_numero) from 15 for 2))
    else null
  end
$$;

-- A UF que o número entrega SOZINHO, sem depender de cadastro.
--
-- Devolve null de propósito onde o tribunal cobre mais de um estado, porque
-- chutar a sede seria inventar dado: TRT-8 (PA+AP), TRT-10 (DF+TO),
-- TRT-11 (AM+RR), TRT-14 (RO+AC) e TODA a Justiça Federal (TRF por região).
-- Nesses casos quem manda é `estado_origem_sigla` da ficha ou `uf_proc` da
-- Tabela Auxiliar; o CNJ entra só como último recurso.
create or replace function public.cnj_uf(p_numero text)
returns text language sql immutable parallel safe as $$
  select case public.cnj_segmento(p_numero)
    when '8' then public.cnj_uf_estadual(substring(public.cnj_digitos(p_numero) from 15 for 2))
    when '6' then public.cnj_uf_estadual(substring(public.cnj_digitos(p_numero) from 15 for 2))
    when '5' then case substring(public.cnj_digitos(p_numero) from 15 for 2)
      when '01' then 'RJ' when '02' then 'SP' when '03' then 'MG' when '04' then 'RS'
      when '05' then 'BA' when '06' then 'PE' when '07' then 'CE'
      when '09' then 'PR'
      when '12' then 'SC' when '13' then 'PB'
      when '15' then 'SP' when '16' then 'MA' when '17' then 'ES' when '18' then 'GO'
      when '19' then 'AL' when '20' then 'SE' when '21' then 'RN' when '22' then 'PI'
      when '23' then 'MT' when '24' then 'MS'
      -- 08, 10, 11, 14 ficam de fora: região com mais de um estado.
      else null
    end
    else null
  end
$$;

comment on function public.cnj_uf(text) is
  'UF derivada do próprio número. Null quando o tribunal cobre mais de um '
  'estado (TRT 8/10/11/14 e todos os TRF) — aí a UF tem de vir do cadastro.';

-- -----------------------------------------------------------------------------
-- 2. Duplicata para de entrar.
-- -----------------------------------------------------------------------------

-- FICHA ÓRFÃ (lead_id null) É SEMPRE DUPLICATA. Sem cliente ela não é uma
-- unidade (processo × cliente) — é cadastro solto. São 559 fichas órfãs na
-- base, e 19 dos 48 grupos repetidos são exatamente isso: uma órfã pendurada
-- no CNJ de uma ficha que tem cliente. Se o gatilho comparasse null com null,
-- essas passariam se disfarçando de litisconsórcio.
create or replace function public.lead_processes_sem_duplicata()
returns trigger language plpgsql as $$
declare
  v_cnj    text;
  v_existe uuid;
  v_motivo text;
begin
  -- Ficha apagada não disputa nada.
  if new.deleted_at is not null then
    return new;
  end if;

  v_cnj := public.cnj_digitos(new.process_number);

  -- Sem CNJ válido não há como afirmar que é o mesmo processo. Cadastro pela
  -- metade continua entrando — a tela é que cobra o número depois.
  if v_cnj is null or length(v_cnj) <> 20 then
    return new;
  end if;

  if new.lead_id is null then
    -- Órfã não divide CNJ com ninguém, tenha a outra cliente ou não.
    select id into v_existe
      from public.lead_processes
     where id <> new.id and deleted_at is null
       and public.cnj_digitos(process_number) = v_cnj
     limit 1;
    v_motivo := 'Ficha sem cliente nao pode dividir CNJ com outra ficha: sem cliente ela nao e uma unidade (processo x cliente), e cadastro solto.';
  else
    -- Com cliente: barra o mesmo cliente e barra órfã pendurada no mesmo CNJ.
    -- Cliente DIFERENTE passa — é litisconsórcio, e o vocabulário FIDC diz que
    -- cada cliente é um recebível próprio.
    select id into v_existe
      from public.lead_processes
     where id <> new.id and deleted_at is null
       and public.cnj_digitos(process_number) = v_cnj
       and (lead_id = new.lead_id or lead_id is null)
     limit 1;
    v_motivo := 'Mesmo CNJ em cliente DIFERENTE e litisconsorcio e e permitido; mesmo cliente, ou ficha sem cliente, e duplicata.';
  end if;

  if v_existe is not null then
    raise exception using
      errcode = '23505',
      message = format('Processo %s ja cadastrado.', new.process_number),
      detail  = format('Ficha existente: %s. Abra ela em vez de criar outra.', v_existe),
      hint    = v_motivo;
  end if;

  return new;
end;
$$;

drop trigger if exists lead_processes_sem_duplicata on public.lead_processes;

create trigger lead_processes_sem_duplicata
  before insert or update of process_number, lead_id, deleted_at
  on public.lead_processes
  for each row execute function public.lead_processes_sem_duplicata();

comment on function public.lead_processes_sem_duplicata() is
  'Barra ficha nova com o mesmo CNJ no mesmo lead. Litisconsórcio (mesmo CNJ, '
  'lead diferente) passa — a unidade do vocabulário FIDC é (processo × cliente).';

-- -----------------------------------------------------------------------------
-- 3. A fila de conferência — o passivo de 68 fichas, separado por natureza.
-- -----------------------------------------------------------------------------

-- Passivo de hoje (24/08/2026), pela natureza:
--   MESMO_CLIENTE      20 grupos, 54 fichas — duplicata pura, mescla
--   ORFA_MAIS_CLIENTE  19 grupos, 40 fichas — órfã pendurada, mescla na que tem cliente
--   LITISCONSORCIO      7 grupos, 14 fichas — legítimo, mantém as duas
--   MISTO               2 grupos,  8 fichas — olhar uma a uma
drop view if exists public.vw_lead_processes_duplicatas;

create view public.vw_lead_processes_duplicatas as
with vivas as (
  select p.id, p.lead_id, p.workflow_id, p.process_number, p.title, p.created_at,
         p.updated_at, p.status, p.area, p.case_id,
         public.cnj_digitos(p.process_number) as cnj,
         -- Quanto de cadastro cada ficha tem: na mesclagem, ganha a mais cheia.
         (case when p.polo_passivo    is not null then 1 else 0 end
        + case when p.envolvidos      is not null then 1 else 0 end
        + case when p.movimentacoes   is not null then 1 else 0 end
        + case when p.valor_causa     is not null then 1 else 0 end
        + case when p.tribunal        is not null then 1 else 0 end
        + case when p.estado_origem_sigla is not null then 1 else 0 end
        + case when p.case_id         is not null then 1 else 0 end
        + case when p.data_distribuicao is not null then 1 else 0 end) as riqueza
    from public.lead_processes p
   where p.deleted_at is null
     and public.cnj_valido(p.process_number)
),
grupos as (
  select cnj,
         count(*)                                as fichas,
         count(distinct lead_id)                 as leads,
         count(*) filter (where lead_id is null) as orfas,
         count(distinct workflow_id)             as pops
    from vivas group by cnj
   having count(*) > 1
)
select v.cnj,
       public.cnj_ramo(v.process_number)  as ramo,
       public.cnj_uf(v.process_number)    as uf_cnj,
       g.fichas, g.leads, g.orfas, g.pops,
       case when g.orfas = g.fichas then 'ORFAS'
            when g.orfas > 0        then 'ORFA_MAIS_CLIENTE'
            when g.leads = 1        then 'MESMO_CLIENTE'
            when g.leads = g.fichas then 'LITISCONSORCIO'
            else 'MISTO' end             as natureza,
       v.id, v.lead_id, v.workflow_id, v.process_number, v.title,
       v.status, v.area, v.case_id, v.created_at, v.updated_at, v.riqueza,
       -- 1 = a ficha mais completa do grupo (empate: a mais antiga fica).
       row_number() over (
         partition by v.cnj, v.lead_id
         order by v.riqueza desc, v.created_at asc
       )                                  as posto_no_lead
  from vivas v
  join grupos g on g.cnj = v.cnj;

comment on view public.vw_lead_processes_duplicatas is
  'Fila de conferencia de CNJ repetido. natureza: MESMO_CLIENTE e '
  'ORFA_MAIS_CLIENTE sao duplicata (mesclar); LITISCONSORCIO e legitimo '
  '(manter); MISTO e ORFAS pedem olhar. posto_no_lead=1 e a ficha mais '
  'completa do cliente.';

grant execute on function public.cnj_digitos(text)      to authenticated, anon, service_role;
grant execute on function public.cnj_valido(text)       to authenticated, anon, service_role;
grant execute on function public.cnj_segmento(text)     to authenticated, anon, service_role;
grant execute on function public.cnj_ramo(text)         to authenticated, anon, service_role;
grant execute on function public.cnj_tribunal(text)     to authenticated, anon, service_role;
grant execute on function public.cnj_uf(text)           to authenticated, anon, service_role;
grant execute on function public.cnj_uf_estadual(text)  to authenticated, anon, service_role;
grant select on public.vw_lead_processes_duplicatas     to authenticated, anon, service_role;

-- Busca por número escrito de qualquer jeito, e classificação por ramo, sem
-- varrer a tabela.
create index if not exists lead_processes_cnj_digitos_idx
  on public.lead_processes (public.cnj_digitos(process_number))
  where deleted_at is null;
