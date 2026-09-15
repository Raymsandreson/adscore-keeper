-- ============================================================================
-- RISCO DE BANIMENTO DE INSTÂNCIA WHATSAPP — detector, freio e roteamento
-- Projeto EXTERNO (kmedldlepwiityjsdahz), onde mora whatsapp_messages.
--
-- Por que existe: em 2026 três instâncias morreram do mesmo jeito, corte seco
-- no meio de um dia útil, sempre depois de uma rampa de abordagem a número
-- novo:
--   ISRAEL ATENDIMENTO  — ter 11/08 10:48 (369 msgs desde 09:29), 35 dias mudo
--   Karolyne Atendimento— qua 02/09 18:49, depois de rajada de 96 novos em 10/08
--   Mateus Atendimento  — sex 11/09 10:53, no dia seguinte a 99 números novos
-- Quem sobreviveu (Raym 0,07 enviada por recebida; Luiz 0,12) é quem RESPONDE.
-- Quem morreu é quem ABORDA. O gatilho não é o volume: é o número novo.
--
-- Este arquivo não filtra nem esconde nada. Ele DETECTA e ROTEIA:
--   1. mede o risco de cada instância e guarda num snapshot (tela em tempo real)
--   2. freia o envio antes de sair, quando a instância passou do teto
--   3. aponta QUAL outra instância deve mandar no lugar
--   4. acusa texto repetido e devolve o texto para variar
-- Nada aqui apaga mensagem, nada aqui some com conversa.
--
-- ROLLBACK (< 1 min, testado na ordem):
--   select cron.unschedule('wa-risco-tick');
--   drop function if exists public.wa_risco_tick();
--   drop function if exists public.wa_gate_envio(text,text,text);
--   drop function if exists public.wa_instancia_alternativa(text,text);
--   drop table if exists public.wa_instancia_risco, public.wa_envio_contador,
--                        public.wa_texto_usado, public.wa_risco_config;
--   e remover a chamada do gate na edge function (ver v30 do send-whatsapp).
-- Sem isso tudo, o sistema volta exatamente ao comportamento de hoje: envia
-- sem freio nenhum.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONFIGURAÇÃO — limiares editáveis sem migration
--
-- Os números NÃO vieram de documentação do Meta: o Meta não publica o que
-- dispara banimento em uso não-oficial (UazAPI/Baileys é violação de termos,
-- não tem contrato nem tabela de limites). Vieram da NOSSA base: 3 instâncias
-- mortas contra 6 vivas. Amostra pequena — é heurística calibrada, não lei.
-- Por isso mora em tabela: quando a próxima cair (ou não cair), ajusta-se aqui.
-- ----------------------------------------------------------------------------
create table if not exists public.wa_risco_config (
  id boolean primary key default true check (id),

  -- Razão enviadas/recebidas, só conversa 1:1 (grupo fora).
  -- CRITÉRIO FRACO, de propósito com peso baixo. Contando grupo, ela separava
  -- lindamente morta de viva (Mateus 0,84 contra Raym 0,07) — mas grupo é
  -- conversa de cliente já fechado e não protege ninguém de banimento por
  -- abordar estranho. Tirando grupo, a separação some: Mateus morreu com 1,04
  -- e Luiz Abraci vive com 0,85, Andressa com 0,90. Fica como termômetro, não
  -- como sentença.
  razao_env_rec_alvo      numeric not null default 0.80,
  razao_env_rec_teto      numeric not null default 1.20,

  -- Conversas que nós começamos e o outro lado nunca respondeu. É o proxy mais
  -- perto de "quantos me denunciaram": quem não responde é quem bloqueia.
  -- Limiar alto porque Andressa (SDR, viva) trabalha em 33,6%. Abaixo disso o
  -- alarme tocaria na função dela, não no risco dela.
  pct_fria_sem_resp_alerta numeric not null default 25.0,
  pct_fria_sem_resp_teto   numeric not null default 40.0,

  -- Números NOVOS por dia. ESTE é o critério forte: é o único que separa as
  -- três mortas de todas as vivas, sem sobreposição nenhuma.
  --   mortas: Israel 70-111/dia · Karolyne 96 · Mateus 78-99
  --   vivas:  Andressa 30 · Raym 13 · Processual 6 · Analyne 7 · Luiz 3
  -- Por isso leva quase metade da pontuação sozinho.
  novos_por_dia_alerta    int not null default 20,
  novos_por_dia_teto      int not null default 40,

  -- Segundos mínimos entre abordar um desconhecido e o próximo. O menor gap
  -- medido nas mortas foi 5,3s (Karolyne), 6,0s (Israel), 6,9s (Mateus).
  -- Nenhum humano no aplicativo faz isso. É a assinatura de máquina.
  intervalo_min_novo_seg  int not null default 75,
  jitter_seg              int not null default 45,

  -- Texto colado. Mateus: 56% das primeiras mensagens repetidas. Analyne: 53%.
  -- Texto colado nas primeiras mensagens. Também FRACO sozinho: Analyne vive
  -- com 61,6% e Mateus morreu com 60,2%. Vale como aviso para variar o texto,
  -- não como prova de risco.
  pct_texto_repetido_alerta numeric not null default 40.0,
  pct_texto_repetido_teto   numeric not null default 60.0,
  texto_max_destinos        int not null default 5,

  -- Silêncio. Israel ficou 35 dias mudo sem ninguém perceber, porque o monitor
  -- de conexão (instance_connection_log) parou de ser alimentado em 28/04/2026.
  horas_silencio_alerta   int not null default 18,
  horas_silencio_critico  int not null default 48,
  horas_inatividade_usuario int not null default 168,   -- 7 dias = instância abandonada

  atualizado_em timestamptz not null default now()
);
insert into public.wa_risco_config (id) values (true) on conflict (id) do nothing;

alter table public.wa_risco_config enable row level security;
drop policy if exists wa_risco_config_leitura on public.wa_risco_config;
create policy wa_risco_config_leitura on public.wa_risco_config
  for select using (auth.role() in ('authenticated','service_role'));
drop policy if exists wa_risco_config_escrita on public.wa_risco_config;
create policy wa_risco_config_escrita on public.wa_risco_config
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- 2. SNAPSHOT DE RISCO — o que a tela lê
--
-- É tabela, não view. whatsapp_messages tem 7,8 GB e 1,76 M linhas: recalcular
-- a cada render derrubaria o painel e o banco junto. O tick reescreve isto a
-- cada 15 min e a tela assina Realtime — fica vivo sem varrer nada.
-- ----------------------------------------------------------------------------
create table if not exists public.wa_instancia_risco (
  instance_name text primary key,
  owner_name    text,

  enviadas_7d   int not null default 0,
  recebidas_7d  int not null default 0,
  razao_env_rec numeric,

  conversas_7d      int not null default 0,
  iniciadas_por_nos int not null default 0,
  frias_sem_resposta int not null default 0,
  pct_fria_sem_resposta numeric,

  novos_hoje    int not null default 0,
  novos_pico_7d int not null default 0,
  gap_mediano_seg numeric,
  gap_minimo_seg  numeric,
  abordagens_em_rajada int not null default 0,

  primeiras_msgs int not null default 0,
  textos_distintos int not null default 0,
  pct_texto_repetido numeric,

  ultima_msg          timestamptz,
  horas_sem_atividade numeric,
  inativa             boolean not null default false,

  score           int not null default 0,
  classificacao   text not null default 'SEM DADOS',
  motivos         text[] not null default '{}',
  calculado_em    timestamptz not null default now()
);

alter table public.wa_instancia_risco enable row level security;
drop policy if exists wa_instancia_risco_leitura on public.wa_instancia_risco;
create policy wa_instancia_risco_leitura on public.wa_instancia_risco
  for select using (auth.role() in ('authenticated','service_role'));
drop policy if exists wa_instancia_risco_escrita on public.wa_instancia_risco;
create policy wa_instancia_risco_escrita on public.wa_instancia_risco
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index if not exists idx_wa_risco_score on public.wa_instancia_risco (score desc);

-- ----------------------------------------------------------------------------
-- 3. CONTADORES DO FREIO — O(1), nunca varrem whatsapp_messages
--
-- O gate roda em TODO envio. Se ele fizesse count() na tabela de 7,8 GB, o
-- remédio mataria o paciente. Então ele mantém o próprio placar.
-- ----------------------------------------------------------------------------
create table if not exists public.wa_envio_contador (
  instance_name text not null,
  dia           date not null,
  numeros_novos int not null default 0,
  envios_total  int not null default 0,
  ultimo_novo_em timestamptz,
  primary key (instance_name, dia)
);
alter table public.wa_envio_contador enable row level security;
drop policy if exists wa_envio_contador_leitura on public.wa_envio_contador;
create policy wa_envio_contador_leitura on public.wa_envio_contador
  for select using (auth.role() in ('authenticated','service_role'));
drop policy if exists wa_envio_contador_escrita on public.wa_envio_contador;
create policy wa_envio_contador_escrita on public.wa_envio_contador
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Texto já usado: hash do texto normalizado → em quantos destinos diferentes já
-- foi. Guarda uma amostra do texto para a tela mostrar o que repetiu.
create table if not exists public.wa_texto_usado (
  instance_name text not null,
  hash_texto    text not null,
  destinos      int not null default 0,
  amostra       text,
  primeiro_uso  timestamptz not null default now(),
  ultimo_uso    timestamptz not null default now(),
  primary key (instance_name, hash_texto)
);
alter table public.wa_texto_usado enable row level security;
drop policy if exists wa_texto_usado_leitura on public.wa_texto_usado;
create policy wa_texto_usado_leitura on public.wa_texto_usado
  for select using (auth.role() in ('authenticated','service_role'));
drop policy if exists wa_texto_usado_escrita on public.wa_texto_usado;
create policy wa_texto_usado_escrita on public.wa_texto_usado
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index if not exists idx_wa_texto_usado_ultimo on public.wa_texto_usado (ultimo_uso desc);

-- ----------------------------------------------------------------------------
-- 4. O TICK — recalcula o snapshot de risco
--
-- DUAS JANELAS, de propósito:
--   30 dias → razão enviadas/recebidas, % conversa fria muda, % texto repetido.
--             Comportamento acumulado. Foi nesta janela que os limiares foram
--             calibrados e é nela que morta e viva se separam (Mateus 0,84 /
--             Raym 0,07). Em 7 dias a mesma razão dá 1,04 e 0,41 — o alarme
--             apontaria gente saudável, e alarme que mente ninguém obedece.
--   7 dias / hoje → números novos, ritmo, rajada. Operação do momento.
--
-- UMA varredura, não quatro. `explain analyze` do agregado de 30 dias sozinho:
-- 9.712 ms, 20.592 buffers lidos do disco. Com quatro CTEs lendo a tabela de
-- 7,8 GB o tick passaria de 30s a cada 15 min. Então a fatia vira tabela
-- temporária (49 mil linhas em 30 dias, fora grupo) e todo o resto roda ali
-- dentro, em memória.
--
-- Grupo fica de fora (phone com '-', '@' ou prefixo 120363): mensagem no grupo
-- do cliente não é abordagem a desconhecido.
--
-- Abordagem fria só conta como "sem resposta" depois de 24h — antes disso a
-- pessoa ainda pode estar no almoço.
-- ----------------------------------------------------------------------------
create or replace function public.wa_risco_tick()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.wa_risco_config%rowtype;
  n int;
begin
  select * into cfg from public.wa_risco_config where id;

  create temp table _wa_base on commit drop as
  select lower(instance_name) as inst, phone, direction, created_at,
         left(regexp_replace(lower(coalesce(message_text,'')), '\s+', ' ', 'g'), 80) as texto_norm
  from public.whatsapp_messages
  where created_at > now() - interval '30 days'
    and instance_name is not null
    and phone is not null
    and phone not like '%-%'
    and phone not like '%@%'
    and phone not like '120363%';

  create index on _wa_base (inst, phone, created_at);
  analyze _wa_base;

  -- Primeira mensagem de cada conversa, nas duas janelas. Quem puxou o assunto.
  create temp table _wa_primeira on commit drop as
  select distinct on (inst, phone) inst, phone, direction, created_at, texto_norm
  from _wa_base order by inst, phone, created_at;

  create temp table _wa_primeira7 on commit drop as
  select distinct on (inst, phone) inst, phone, direction, created_at, texto_norm
  from _wa_base where created_at > now() - interval '7 days'
  order by inst, phone, created_at;

  analyze _wa_primeira;
  analyze _wa_primeira7;

  with volume as (
    select inst,
           count(*) filter (where direction = 'outbound') as enviadas30,
           count(*) filter (where direction = 'inbound')  as recebidas30,
           count(*) filter (where direction = 'outbound'
                              and created_at > now() - interval '7 days') as enviadas7,
           count(*) filter (where direction = 'inbound'
                              and created_at > now() - interval '7 days') as recebidas7,
           max(created_at) as ultima_msg
    from _wa_base group by 1
  ),
  respostas as (
    select inst, phone, count(*) filter (where direction='inbound') as inbound
    from _wa_base group by 1, 2
  ),
  conversas as (
    select p.inst,
           count(*) as conversas,
           count(*) filter (where p.direction='outbound') as iniciadas,
           count(*) filter (where p.direction='outbound'
                              and r.inbound = 0
                              and p.created_at < now() - interval '24 hours') as frias_mudas,
           count(*) filter (where p.direction='outbound') as primeiras,
           count(distinct case when p.direction='outbound' then p.texto_norm end) as textos_distintos
    from _wa_primeira p
    join respostas r on r.inst = p.inst and r.phone = p.phone
    group by 1
  ),
  -- Ritmo: intervalo entre abordar um desconhecido e o próximo, nos 7 dias.
  ritmo as (
    select inst, created_at,
           extract(epoch from (created_at - lag(created_at) over (
             partition by inst, (created_at at time zone 'America/Sao_Paulo')::date
             order by created_at))) as gap,
           count(*) over (partition by inst,
             (created_at at time zone 'America/Sao_Paulo')::date) as dia_novos
    from _wa_primeira7 where direction = 'outbound'
  ),
  ritmo_agg as (
    select inst,
           percentile_cont(0.5) within group (order by gap) as gap_mediano,
           min(gap) as gap_min,
           count(*) filter (where gap < 20) as rajada,
           max(dia_novos) as pico
    from ritmo group by 1
  ),
  hoje as (
    select inst, count(*) as novos_hoje
    from _wa_primeira7
    where direction = 'outbound'
      and (created_at at time zone 'America/Sao_Paulo')::date
          = (now() at time zone 'America/Sao_Paulo')::date
    group by 1
  ),
  -- Toda instância ativa entra, mesmo a que não mandou nada em 30 dias: é
  -- assim que a abandonada aparece na lista em vez de desaparecer dela.
  juntado as (
    select i.instance_name, i.owner_name,
           coalesce(v.enviadas7, 0) as enviadas7, coalesce(v.recebidas7, 0) as recebidas7,
           coalesce(v.enviadas30, 0) as enviadas30, coalesce(v.recebidas30, 0) as recebidas30,
           v.ultima_msg,
           coalesce(c.conversas, 0) as conversas, coalesce(c.iniciadas, 0) as iniciadas,
           coalesce(c.frias_mudas, 0) as frias_mudas,
           coalesce(c.primeiras, 0) as primeiras,
           coalesce(c.textos_distintos, 0) as textos_distintos,
           coalesce(h.novos_hoje, 0) as novos_hoje,
           coalesce(ra.pico, 0) as pico,
           ra.gap_mediano, ra.gap_min, coalesce(ra.rajada, 0) as rajada
    from public.whatsapp_instances i
    left join volume v     on v.inst  = lower(i.instance_name)
    left join conversas c  on c.inst  = lower(i.instance_name)
    left join ritmo_agg ra on ra.inst = lower(i.instance_name)
    left join hoje h       on h.inst  = lower(i.instance_name)
    where coalesce(i.is_active, true)
  ),
  -- Última mensagem de verdade, inclusive fora dos 30 dias. Sem isto, quem
  -- morreu há 35 dias apareceria como "0 mensagens" em vez de "morta há 35
  -- dias" — que é justamente o que aconteceu com o ISRAEL ATENDIMENTO.
  --
  -- Vem do snapshot anterior, NÃO de um max() na tabela grande. Fazer
  -- `max(created_at) where lower(instance_name)=X` por instância estourou o
  -- teste de 60s sozinho: sem índice por instância+data, cada uma varre a
  -- tabela inteira. E é informação que não muda — instância muda ontem
  -- continua com a mesma última mensagem hoje. O valor inicial é semeado uma
  -- única vez no fim desta migration, com o índice já criado.
  ultima_real as (
    select j.instance_name,
           coalesce(j.ultima_msg, r.ultima_msg) as ultima
    from juntado j
    left join public.wa_instancia_risco r on r.instance_name = j.instance_name
  ),
  calculado as (
    select j.*, u.ultima as ultima_real,
           round(extract(epoch from (now() - u.ultima)) / 3600.0, 1) as horas_mudo,
           case when j.recebidas30 > 0
                then round(j.enviadas30::numeric / j.recebidas30, 2) end as razao,
           case when j.conversas > 0
                then round(100.0 * j.frias_mudas / j.conversas, 1) end as pct_fria,
           case when j.primeiras > 0
                then round(100.0 - 100.0 * j.textos_distintos / j.primeiras, 1) end as pct_repetido
    from juntado j join ultima_real u on u.instance_name = j.instance_name
  ),
  -- Pontuação: cada critério vale no máximo o seu peso, somando 100.
  --
  -- Os pesos NÃO são opinião — saíram de olhar quais números separam as três
  -- instâncias que morreram das seis que continuam vivas:
  --   número novo/dia (45) — separação limpa, sem sobreposição. O critério.
  --   ritmo de máquina (25) — as três mortas abordaram desconhecido com 5,3s,
  --                           6,0s e 6,9s de intervalo. Ninguém faz isso à mão.
  --   conversa fria muda (15) — indica, mas Andressa vive em 33,6%.
  --   texto repetido (10) — indica, mas Analyne vive em 61,6%.
  --   razão env/rec (5) — quase não discrimina fora de grupo. Termômetro.
  --
  -- Calibrado para NÃO acusar quem está saudável: com estes pesos, Raym marca
  -- ~12, Luiz ~2, Analyne ~19 e Andressa ~24 (ATENÇÃO, que é o correto para
  -- quem prospecta), enquanto Mateus no dia da queda passaria de 60.
  pontuado as (
    select c.*,
      least(100, (
          case when c.novos_hoje   >= cfg.novos_por_dia_teto   then 25
               when c.novos_hoje   >= cfg.novos_por_dia_alerta then 12 else 0 end
        + case when c.pico         >= cfg.novos_por_dia_teto   then 20
               when c.pico         >= cfg.novos_por_dia_alerta then 10 else 0 end
        + case when c.rajada > 5 then 15 when c.rajada > 0 then 8 else 0 end
        + case when c.gap_min is not null and c.gap_min < 20 then 10
               when c.gap_min is not null and c.gap_min < cfg.intervalo_min_novo_seg then 5
               else 0 end
        + case when c.pct_fria     >= cfg.pct_fria_sem_resp_teto   then 15
               when c.pct_fria     >= cfg.pct_fria_sem_resp_alerta then 7 else 0 end
        + case when c.pct_repetido >= cfg.pct_texto_repetido_teto   then 10
               when c.pct_repetido >= cfg.pct_texto_repetido_alerta then 5 else 0 end
        + case when c.razao        >= cfg.razao_env_rec_teto   then 5
               when c.razao        >= cfg.razao_env_rec_alvo   then 2 else 0 end
      )) as score_bruto
    from calculado c cross join public.wa_risco_config cfg where cfg.id
  )
  insert into public.wa_instancia_risco as t (
    instance_name, owner_name, enviadas_7d, recebidas_7d, razao_env_rec,
    conversas_7d, iniciadas_por_nos, frias_sem_resposta, pct_fria_sem_resposta,
    novos_hoje, novos_pico_7d, gap_mediano_seg, gap_minimo_seg, abordagens_em_rajada,
    primeiras_msgs, textos_distintos, pct_texto_repetido,
    ultima_msg, horas_sem_atividade, inativa, score, classificacao, motivos, calculado_em
  )
  select
    p.instance_name, p.owner_name, p.enviadas7, p.recebidas7, p.razao,
    p.conversas, p.iniciadas, p.frias_mudas, p.pct_fria,
    p.novos_hoje, p.pico,
    round(p.gap_mediano::numeric, 1), round(p.gap_min::numeric, 1), p.rajada,
    p.primeiras, p.textos_distintos, p.pct_repetido,
    p.ultima_real, p.horas_mudo,
    (p.horas_mudo is null or p.horas_mudo >= cfg.horas_inatividade_usuario),
    p.score_bruto,
    case
      -- Silêncio longo depois de ter sido ativa é o retrato do banimento: foi
      -- assim que Israel, Karolyne e Mateus saíram do ar.
      when p.horas_mudo is null then 'NUNCA USADA'
      when p.horas_mudo >= cfg.horas_inatividade_usuario then 'ABANDONADA'
      when p.horas_mudo >= cfg.horas_silencio_critico then 'PROVAVELMENTE BANIDA'
      when p.horas_mudo >= cfg.horas_silencio_alerta  then 'SILÊNCIO SUSPEITO'
      when p.score_bruto >= 50 then 'CRÍTICO'
      when p.score_bruto >= 25 then 'ATENÇÃO'
      else 'OK'
    end,
    array_remove(array[
      case when p.novos_hoje >= cfg.novos_por_dia_alerta
           then format('%s números novos hoje (alerta %s, teto %s)',
                       p.novos_hoje, cfg.novos_por_dia_alerta, cfg.novos_por_dia_teto) end,
      case when p.pct_fria >= cfg.pct_fria_sem_resp_alerta
           then format('%s%% das conversas fomos nós que abrimos e nunca responderam (%s de %s)',
                       p.pct_fria, p.frias_mudas, p.conversas) end,
      case when p.razao >= cfg.razao_env_rec_alvo
           then format('manda %s mensagem para cada 1 recebida — alvo: até %s',
                       p.razao, cfg.razao_env_rec_alvo) end,
      case when p.pct_repetido >= cfg.pct_texto_repetido_alerta
           then format('%s%% das primeiras mensagens são texto repetido', p.pct_repetido) end,
      case when p.rajada > 0
           then format('%s abordagens a desconhecido com menos de 20s entre elas', p.rajada) end,
      case when p.gap_min is not null and p.gap_min < cfg.intervalo_min_novo_seg
           then format('menor intervalo entre abordagens: %ss (mínimo %ss)',
                       round(p.gap_min::numeric,1), cfg.intervalo_min_novo_seg) end,
      case when p.horas_mudo >= cfg.horas_silencio_alerta
           then format('sem nenhuma mensagem há %sh', p.horas_mudo) end
    ], null),
    now()
  from pontuado p cross join public.wa_risco_config cfg where cfg.id
  on conflict (instance_name) do update set
    owner_name = excluded.owner_name,
    enviadas_7d = excluded.enviadas_7d, recebidas_7d = excluded.recebidas_7d,
    razao_env_rec = excluded.razao_env_rec,
    conversas_7d = excluded.conversas_7d, iniciadas_por_nos = excluded.iniciadas_por_nos,
    frias_sem_resposta = excluded.frias_sem_resposta,
    pct_fria_sem_resposta = excluded.pct_fria_sem_resposta,
    novos_hoje = excluded.novos_hoje, novos_pico_7d = excluded.novos_pico_7d,
    gap_mediano_seg = excluded.gap_mediano_seg, gap_minimo_seg = excluded.gap_minimo_seg,
    abordagens_em_rajada = excluded.abordagens_em_rajada,
    primeiras_msgs = excluded.primeiras_msgs, textos_distintos = excluded.textos_distintos,
    pct_texto_repetido = excluded.pct_texto_repetido,
    ultima_msg = excluded.ultima_msg, horas_sem_atividade = excluded.horas_sem_atividade,
    inativa = excluded.inativa, score = excluded.score,
    classificacao = excluded.classificacao, motivos = excluded.motivos,
    calculado_em = excluded.calculado_em;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. INSTÂNCIA ALTERNATIVA — quem manda no lugar de quem está no limite
--
-- Preferência, nesta ordem:
--   1. instância que JÁ falou com este número (o cliente reconhece o remetente)
--   2. a de menor risco, com folga de cota no dia e viva nas últimas 24h
-- Nunca devolve instância muda: trocar um número queimado por outro morto é
-- empurrar o problema para debaixo do tapete.
-- ----------------------------------------------------------------------------
create or replace function public.wa_instancia_alternativa(p_instancia text, p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (select * from public.wa_risco_config where id),
  conhecidas as (
    select distinct lower(m.instance_name) as inst
    from public.whatsapp_messages m
    where m.phone = regexp_replace(coalesce(p_phone,''), '\D', '', 'g')
      and m.instance_name is not null
      and m.created_at > now() - interval '180 days'
  )
  select r.instance_name
  from public.wa_instancia_risco r
  cross join cfg
  where lower(r.instance_name) <> lower(coalesce(p_instancia,''))
    and r.classificacao in ('OK', 'ATENÇÃO')
    and not r.inativa
    and r.horas_sem_atividade is not null
    and r.horas_sem_atividade < 24
    and coalesce((select numeros_novos from public.wa_envio_contador c
                  where c.instance_name = r.instance_name
                    and c.dia = (now() at time zone 'America/Sao_Paulo')::date), 0)
        < cfg.novos_por_dia_alerta
  order by (lower(r.instance_name) in (select inst from conhecidas)) desc,
           r.score asc,
           r.recebidas_7d desc
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 6. O GATE — roda antes de cada envio
--
-- Regra que sustenta tudo: CONVERSA EM ANDAMENTO NUNCA É FREADA. Se o número
-- já falou com esta instância, passa direto, sem contador e sem espera. O
-- freio existe só para a abordagem a quem nunca respondeu — que é o que matou
-- as três instâncias. Frear resposta a cliente seria quebrar o atendimento
-- para resolver um problema que o atendimento não causa.
--
-- Devolve jsonb com a decisão. Quem chama decide o que fazer: a edge function
-- recusa o envio, a tela mostra o aviso e a sugestão.
-- ----------------------------------------------------------------------------
create or replace function public.wa_gate_envio(
  p_instancia text,
  p_phone     text,
  p_texto     text default null,
  p_registrar boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.wa_risco_config%rowtype;
  v_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_novo  boolean;
  v_cont  public.wa_envio_contador%rowtype;
  v_risco public.wa_instancia_risco%rowtype;
  v_hash  text;
  v_destinos int := 0;
  v_espera int := 0;
  v_intervalo int;
  v_alt text;
begin
  select * into cfg from public.wa_risco_config where id;

  if p_instancia is null or v_phone = '' then
    return jsonb_build_object('permitido', true, 'codigo', 'SEM_DADOS');
  end if;

  -- Grupo não passa pelo freio: mensagem em grupo do cliente não é abordagem.
  if p_phone like '%@g.us' or p_phone like '120363%' or length(v_phone) > 15 then
    return jsonb_build_object('permitido', true, 'codigo', 'GRUPO');
  end if;

  select not exists (
    select 1 from public.whatsapp_messages m
    where m.phone = v_phone
      and lower(m.instance_name) = lower(p_instancia)
  ) into v_novo;

  select * into v_risco from public.wa_instancia_risco
   where lower(instance_name) = lower(p_instancia);

  -- Texto repetido: vale para qualquer envio, novo ou não. É o aviso que pede
  -- variação — não bloqueia conversa em andamento, só acusa.
  if p_texto is not null and length(trim(p_texto)) > 15 then
    v_hash := md5(left(regexp_replace(lower(trim(p_texto)), '\s+', ' ', 'g'), 300));
    select destinos into v_destinos from public.wa_texto_usado
     where instance_name = p_instancia and hash_texto = v_hash;
    v_destinos := coalesce(v_destinos, 0);
  end if;

  -- ===== conversa em andamento: passa =====
  if not v_novo then
    if p_registrar then
      insert into public.wa_envio_contador (instance_name, dia, envios_total)
      values (p_instancia, v_hoje, 1)
      on conflict (instance_name, dia) do update
        set envios_total = public.wa_envio_contador.envios_total + 1;
      if v_hash is not null then
        insert into public.wa_texto_usado (instance_name, hash_texto, destinos, amostra)
        values (p_instancia, v_hash, 1, left(p_texto, 200))
        on conflict (instance_name, hash_texto) do update
          set destinos = public.wa_texto_usado.destinos + 1, ultimo_uso = now();
      end if;
    end if;
    return jsonb_build_object(
      'permitido', true,
      'codigo', 'CONVERSA_EM_ANDAMENTO',
      'e_numero_novo', false,
      'texto_repetido_em', v_destinos,
      'avisar_texto_repetido', v_destinos >= cfg.texto_max_destinos
    );
  end if;

  -- ===== abordagem a número novo: aqui é onde o freio existe =====
  select * into v_cont from public.wa_envio_contador
   where instance_name = p_instancia and dia = v_hoje;

  -- 1) instância já classificada como morta ou em silêncio suspeito
  if v_risco.classificacao in ('PROVAVELMENTE BANIDA', 'SILÊNCIO SUSPEITO', 'ABANDONADA') then
    v_alt := public.wa_instancia_alternativa(p_instancia, v_phone);
    return jsonb_build_object(
      'permitido', false, 'codigo', 'INSTANCIA_FORA_DO_AR',
      'motivo', format('%s está %s (sem mensagem há %sh). Abordar número novo por ela agora é queimar o que sobrou.',
                       p_instancia, lower(v_risco.classificacao), coalesce(v_risco.horas_sem_atividade, 0)),
      'e_numero_novo', true, 'instancia_sugerida', v_alt);
  end if;

  -- 2) teto diário de números novos
  if coalesce(v_cont.numeros_novos, 0) >= cfg.novos_por_dia_teto then
    v_alt := public.wa_instancia_alternativa(p_instancia, v_phone);
    return jsonb_build_object(
      'permitido', false, 'codigo', 'TETO_DIARIO',
      'motivo', format('%s já abordou %s números novos hoje (teto %s). As três instâncias que perdemos em 2026 caíram fazendo de 50 a 99 num dia.',
                       p_instancia, v_cont.numeros_novos, cfg.novos_por_dia_teto),
      'e_numero_novo', true, 'numeros_novos_hoje', v_cont.numeros_novos,
      'instancia_sugerida', v_alt);
  end if;

  -- 3) ritmo — intervalo mínimo com variação, para não ter cadência de robô
  v_intervalo := cfg.intervalo_min_novo_seg
               + floor(random() * greatest(cfg.jitter_seg, 1))::int;
  if v_cont.ultimo_novo_em is not null then
    v_espera := greatest(0, v_intervalo - floor(extract(epoch from (now() - v_cont.ultimo_novo_em)))::int);
  end if;
  if v_espera > 0 then
    return jsonb_build_object(
      'permitido', false, 'codigo', 'RITMO',
      'motivo', format('última abordagem a número novo foi há %ss. Espere %ss.',
                       floor(extract(epoch from (now() - v_cont.ultimo_novo_em)))::int, v_espera),
      'e_numero_novo', true, 'esperar_segundos', v_espera);
  end if;

  -- 4) texto colado em número novo: isso sim é assinatura de disparo
  if v_destinos >= cfg.texto_max_destinos then
    return jsonb_build_object(
      'permitido', false, 'codigo', 'TEXTO_REPETIDO',
      'motivo', format('este mesmo texto já foi a %s números diferentes. Varie antes de mandar para mais um desconhecido.', v_destinos),
      'e_numero_novo', true, 'texto_repetido_em', v_destinos, 'variar_texto', true);
  end if;

  if p_registrar then
    insert into public.wa_envio_contador (instance_name, dia, numeros_novos, envios_total, ultimo_novo_em)
    values (p_instancia, v_hoje, 1, 1, now())
    on conflict (instance_name, dia) do update
      set numeros_novos = public.wa_envio_contador.numeros_novos + 1,
          envios_total  = public.wa_envio_contador.envios_total + 1,
          ultimo_novo_em = now();
    if v_hash is not null then
      insert into public.wa_texto_usado (instance_name, hash_texto, destinos, amostra)
      values (p_instancia, v_hash, 1, left(p_texto, 200))
      on conflict (instance_name, hash_texto) do update
        set destinos = public.wa_texto_usado.destinos + 1, ultimo_uso = now();
    end if;
  end if;

  return jsonb_build_object(
    'permitido', true, 'codigo', 'OK', 'e_numero_novo', true,
    'numeros_novos_hoje', coalesce(v_cont.numeros_novos, 0) + 1,
    'teto_diario', cfg.novos_por_dia_teto,
    'texto_repetido_em', v_destinos,
    'avisar_texto_repetido', v_destinos >= cfg.texto_max_destinos);
end;
$$;

grant execute on function public.wa_gate_envio(text,text,text,boolean) to authenticated, service_role;
grant execute on function public.wa_instancia_alternativa(text,text) to authenticated, service_role;
grant execute on function public.wa_risco_tick() to service_role;

-- ----------------------------------------------------------------------------
-- 7. CRON — o snapshot se atualiza sozinho a cada 15 min
--
-- Era exatamente isto que faltava: instance_connection_log parou de ser
-- alimentado em 28/04/2026 e ninguém soube que o Israel estava morto por 35
-- dias. Monitor que depende de alguém lembrar de rodar não é monitor.
-- ----------------------------------------------------------------------------
select cron.unschedule('wa-risco-tick') where exists (
  select 1 from cron.job where jobname = 'wa-risco-tick'
);
select cron.schedule('wa-risco-tick', '*/15 * * * *', 'select public.wa_risco_tick()');

-- ----------------------------------------------------------------------------
-- 8. SEMEADURA — a última mensagem de cada instância, uma vez só
--
-- Depende do índice criado em 20260915150100 (arquivo separado, porque
-- CREATE INDEX CONCURRENTLY não roda dentro de transação). Rodar isto sem o
-- índice funciona, mas leva minutos: são 25 instâncias x varredura de 7,8 GB.
-- ----------------------------------------------------------------------------
insert into public.wa_instancia_risco (instance_name, owner_name, ultima_msg)
select i.instance_name, i.owner_name,
       (select max(m.created_at) from public.whatsapp_messages m
         where lower(m.instance_name) = lower(i.instance_name))
from public.whatsapp_instances i
where coalesce(i.is_active, true)
on conflict (instance_name) do update
  set ultima_msg = coalesce(public.wa_instancia_risco.ultima_msg, excluded.ultima_msg);

select public.wa_risco_tick();
