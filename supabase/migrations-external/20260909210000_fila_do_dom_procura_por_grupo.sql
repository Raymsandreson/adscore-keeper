-- A fila do Dom para de varrer a caixa inteira. 09/09/2026 — APLICADA.
--
-- SINTOMA: `fila de grupos: canceling statement due to statement timeout`, 2x
-- por dia (15:48 e 16:48 de hoje), sempre no minuto :48.
--
-- MEDIDO ANTES:
--   782 ms com cache quente, mas 111.390 buffers (~870 MB) tocados por chamada
--   para devolver 8 linhas — a cada 2 minutos, 30x por hora.
--   Teto disponível: 8s, herdado do `authenticator` (o `service_role` não tem
--   o seu próprio).
--
-- CAUSA: a CTE `do_cliente` montava TODAS as mensagens das últimas 48h (18.264,
-- das quais só 6.411 são de grupo do piloto) e abria o `metadata` de cada uma
-- para saber quem enviou. São ~6 buffers por linha, quase tudo TOAST. Cabia nos
-- 8s com cache quente; com cache frio, não.
--
-- NÃO bastava reescrever: a primeira tentativa com lateral, sem índice, ficou
-- PIOR (3.166 ms, 148.874 buffers), porque sem índice por telefone+data ela lia
-- todas as mensagens de cada grupo.
--
-- MEDIDO DEPOIS: 57 ms e 11.430 buffers. Mesmo resultado — a nova e a antiga
-- rodadas lado a lado devolveram 20 linhas cada, 20 idênticas em grupo E data,
-- 0 divergentes.
--
-- COMO O ÍNDICE FOI CRIADO (fica registrado porque vai acontecer de novo):
-- `CREATE INDEX CONCURRENTLY` leva ~6 min nesta tabela, e o servidor tem
-- `statement_timeout` de 2 min. Nem o cliente SQL nem o pg_cron passam disso.
-- O caminho que funcionou:
--   1. alter role postgres in database postgres set statement_timeout = '30min';
--   2. cron.schedule de um job com o CREATE INDEX CONCURRENTLY (o pg_cron roda
--      fora de transação, então aceita CONCURRENTLY);
--   3. esperar ficar `indisvalid`, e SÓ ENTÃO desagendar — `cron.unschedule`
--      MATA o job em andamento (perdi uma construção assim);
--   4. alter role postgres in database postgres reset statement_timeout;
-- Toda tentativa abortada deixa um índice inválido de 0 byte que precisa de
-- DROP antes da próxima, senão o `IF NOT EXISTS` pula e nada é construído.
--
-- ROLLBACK: restaurar a definição anterior da função (git, commit anterior a
-- este) e `drop index concurrently public.idx_wam_cliente_por_grupo;`
-- O índice sozinho não muda comportamento nenhum — só a função o usa.

-- 1. O índice. Parcial: só o que NÃO é nosso envio, que é o único lado que a
--    fila procura. 65 MB sobre 1,76 M linhas.
create index concurrently if not exists idx_wam_cliente_por_grupo
  on public.whatsapp_messages (phone, created_at desc)
  where coalesce((metadata -> 'message' ->> 'fromMe')::boolean, false) = false;

-- 2. A função. Parte dos 1.146 grupos do piloto e pergunta, para cada um, qual
--    foi a última mensagem do cliente — em vez de varrer 48h de mensagens e só
--    depois cruzar com os grupos.
create or replace function public.dom_grupos_para_olhar(
  p_limite integer default 20,
  p_janela interval default '48:00:00'::interval
)
returns table(group_jid text, group_name text, lead_id uuid, modo text, ultima_do_cliente timestamptz)
language sql
stable
security definer
set search_path to 'public'
set statement_timeout to '20s'
as $function$
  -- O corte pela última decisão entra DENTRO do lateral de propósito: assim ele
  -- vira condição de índice e o banco nem lê o que já foi decidido.
  select g.group_jid, g.group_name, g.lead_id, g.modo, c.quando
    from public.dom_grupos_piloto g
    cross join lateral (
      select m.created_at as quando
        from public.whatsapp_messages m
       where m.phone = g.group_jid
         and m.created_at > now() - p_janela
         and coalesce((m.metadata -> 'message' ->> 'fromMe')::boolean, false) = false
         and m.created_at > coalesce(
               (select max(d.criado_em) from public.dom_decisoes d
                 where d.group_jid = g.group_jid),
               '-infinity'::timestamptz)
         and not exists (
           select 1
             from public.dom_numeros_equipe e
            where e.ativo
              and e.phone = regexp_replace(
                coalesce(m.metadata -> 'message' ->> 'sender_pn',
                         m.metadata -> 'message' ->> 'sender', ''),
                '\D', '', 'g')
         )
       order by m.created_at desc
       limit 1
    ) c
   where g.ativo
     and g.escopo_status = 'operacional'
   order by c.quando desc
   limit greatest(p_limite, 1);
$function$;
