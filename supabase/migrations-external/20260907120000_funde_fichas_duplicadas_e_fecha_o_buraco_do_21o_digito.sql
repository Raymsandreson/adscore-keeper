-- =============================================================================
-- Duas fichas duplicadas viram uma, e a porta que deixou a segunda entrar fecha.
--
-- O QUE ESTAVA ACONTECENDO
-- Duas fichas com o MESMO processo, no MESMO cliente, dividem o que deveria
-- estar junto. E a divisão não é inofensiva: `sync-email-push/index.ts` monta
-- o índice de processos com
--
--     porChave.set(chaveIdentificador(cls.tipo, cls.digitos), p)
--
-- percorrendo as fichas em `order by id`. Quando duas têm os mesmos dígitos, a
-- segunda SOBRESCREVE a primeira em silêncio — quem recebe as intimações por
-- e-mail é decidido por ordem de UUID. Não há erro, não há aviso: uma das duas
-- fichas simplesmente para de existir para o push.
--
-- Foi o que aconteceu no caso 1. As três intimações por e-mail do processo —
-- incluindo "Publicado Intimação para Emendar em 31/08/2026", um PRAZO —
-- caíram na ficha casca, que não tem POP, nem etapa, nem histórico. Quem
-- acompanha o caso olha a outra ficha e não viu nada.
--
-- CASO 1 — 0056732-43.2026.4.05.8300, cliente cfd8f622
--   FICA  13d685de  "BPC DEFICIENTE"  criada 04/08
--                   TRF5, 15ª Vara Federal de Recife, R$ 29.178, 8 movimenta-
--                   ções do Escavador, POP-BPC no marco de ajuizamento
--   SAI   d55c896e  "PREV 174"        criada 20/08
--                   nenhum dado do processo — mas 3 intimações por e-mail
--   Move: 1 atividade, 3 linhas do feed. O rótulo interno PREV 174 entra no
--   título da que fica, para a equipe não perder o índice que usa.
--
-- CASO 2 — 1505819-97.2025.8.26.0378, cliente 086c7b9f
--   FICA  ab73a87e  CNJ correto, 20 movimentações, 1 marco — mas sem
--                   responsável e com título genérico "Processo"
--   SAI   a3d2f961  "1505819-97.2025.8.26.03788" — 21 dígitos, um 8 a mais
--                   tem o título bom, tem responsável e 2 atividades, uma
--                   ainda PENDENTE
--   Aqui a ficha certa nos dados é a pobre em cuidado, e vice-versa. Por isso
--   é fusão: a que fica herda título, responsável e as duas atividades.
--
--   A terceira ficha deste mesmo CNJ (4ac5e67f, cliente fba33fe2) NÃO é
--   duplicata e não se mexe: é outro cliente no mesmo inquérito. A trava
--   anti-duplicata permite litisconsórcio de propósito.
--
-- O BURACO DO 21º DÍGITO
-- a3d2f961 foi criada em 25/08, DEPOIS da trava anti-duplicata (24/08). Passou
-- porque a trava só age com exatamente 20 dígitos:
--     if v_cnj is null or length(v_cnj) <> 20 then return new; end if;
-- Com 21, ela é outro número — e a validação que subiu em 06/09 tem o mesmo
-- ponto cego. Hoje essa mesma ficha torta entraria de novo, igualzinha.
--
-- A REGRA NOVA, pela FORMA e não pelo tamanho: número escrito na máscara do
-- CNJ (dígitos-dígitos.dígitos.dígitos.dígitos.dígitos) tem que ser um CNJ de
-- verdade. Quem não está nessa máscara continua livre — NB, protocolo, BO e o
-- procedimento do MP 02.16.0079.0389620/2026-57, que tem 21 dígitos e é
-- legítimo.
--
-- CONFERIDO CONTRA A BASE ANTES DE VIRAR TRAVA:
--   1.322 fichas com cara de CNJ  → passam
--       1 ficha com cara de CNJ   → reprova: 1505819-97.2025.8.26.03788
--     413 fichas de outro formato → nenhuma tocada, MP incluído
--
-- AINDA ABERTO (medido, não consertado aqui): 23 grupos de fichas duplicadas
-- pelo mesmo CNJ no mesmo cliente, 62 fichas, 39 a mais do que deveria haver.
-- Todos anteriores à trava de 24/08, exceto o caso 2. Cada um precisa da mesma
-- leitura caso a caso que foi feita aqui — qual ficha tem o dado e qual tem o
-- cuidado nem sempre é a mesma.
--
-- ROLLBACK (tudo reversível, nada foi apagado):
--   update lead_activities a set process_id = b.process_id_antigo,
--          process_title = b.antes->>'process_title'
--     from zz_fusao_fichas_bkp_20260907 b
--    where b.tabela='lead_activities' and a.id = b.linha_id;
--   update process_updates u set process_id = b.process_id_antigo,
--          numero_cnj = b.antes->>'numero_cnj',
--          processo_titulo = b.antes->>'processo_titulo'
--     from zz_fusao_fichas_bkp_20260907 b
--    where b.tabela='process_updates' and u.id = b.linha_id;
--   update lead_processes p set deleted_at = (b.antes->>'deleted_at')::timestamptz,
--          title = b.antes->>'title',
--          responsible_user_id = (b.antes->>'responsible_user_id')::uuid,
--          data_ultima_movimentacao = b.antes->>'data_ultima_movimentacao'
--     from zz_fusao_fichas_bkp_20260907 b
--    where b.tabela='lead_processes' and p.id = b.linha_id;
-- =============================================================================

-- 0. Rota de fuga: cada linha que sai do lugar fica registrada -----------------
create table if not exists public.zz_fusao_fichas_bkp_20260907 (
  tabela             text        not null,
  linha_id           uuid        not null,
  process_id_antigo  uuid,
  process_id_novo    uuid,
  antes              jsonb       not null,
  gravado_em         timestamptz not null default now(),
  primary key (tabela, linha_id)
);

comment on table public.zz_fusao_fichas_bkp_20260907 is
  'Estado anterior das linhas movidas na fusao das fichas duplicadas de 07/09/2026. Guarda o process_id antigo e a linha inteira em jsonb — o rollback esta no cabecalho da migration 20260907120000.';

insert into public.zz_fusao_fichas_bkp_20260907 (tabela, linha_id, process_id_antigo, process_id_novo, antes)
select 'lead_activities', a.id, a.process_id,
       case a.process_id
         when 'd55c896e-b96f-4415-a4d5-23417da136a5'::uuid then '13d685de-df16-4f38-8163-6e53a085def1'::uuid
         when 'a3d2f961-8161-4e98-9c8f-be22590fc3fe'::uuid then 'ab73a87e-ef9e-44e4-8fa8-706423d7436a'::uuid
       end,
       to_jsonb(a)
  from public.lead_activities a
 where a.process_id in ('d55c896e-b96f-4415-a4d5-23417da136a5','a3d2f961-8161-4e98-9c8f-be22590fc3fe')
on conflict do nothing;

insert into public.zz_fusao_fichas_bkp_20260907 (tabela, linha_id, process_id_antigo, process_id_novo, antes)
select 'process_updates', u.id, u.process_id, '13d685de-df16-4f38-8163-6e53a085def1'::uuid, to_jsonb(u)
  from public.process_updates u
 where u.process_id = 'd55c896e-b96f-4415-a4d5-23417da136a5'
on conflict do nothing;

insert into public.zz_fusao_fichas_bkp_20260907 (tabela, linha_id, process_id_antigo, process_id_novo, antes)
select 'lead_processes', p.id, p.id, null, to_jsonb(p)
  from public.lead_processes p
 where p.id in ('d55c896e-b96f-4415-a4d5-23417da136a5','a3d2f961-8161-4e98-9c8f-be22590fc3fe',
                '13d685de-df16-4f38-8163-6e53a085def1','ab73a87e-ef9e-44e4-8fa8-706423d7436a')
on conflict do nothing;

-- 1. CASO 1 — a casca devolve o que recebeu -----------------------------------
-- lead_id e case_id sao identicos nas duas fichas; so o process_id muda.
-- process_title e desnormalizado: o card da atividade mostra esse texto, nao a
-- ficha. Se so o process_id mudasse, o card continuaria exibindo PREV 174.
update public.lead_activities
   set process_id    = '13d685de-df16-4f38-8163-6e53a085def1',
       process_title = '0056732-43.2026.4.05.8300 - BPC DEFICIENTE — PREV 174'
 where process_id = 'd55c896e-b96f-4415-a4d5-23417da136a5';

-- O feed guarda numero_cnj e titulo desnormalizados: iam com o espaco no fim
-- e com o rotulo da ficha que sai. Vao para a forma da ficha que fica.
update public.process_updates
   set process_id      = '13d685de-df16-4f38-8163-6e53a085def1',
       numero_cnj      = '0056732-43.2026.4.05.8300',
       processo_titulo = 'BPC DEFICIENTE — PREV 174'
 where process_id = 'd55c896e-b96f-4415-a4d5-23417da136a5';

-- PREV 174 e como a equipe indexa este caso. Some a ficha, o rotulo fica.
update public.lead_processes
   set title = 'BPC DEFICIENTE — PREV 174'
 where id = '13d685de-df16-4f38-8163-6e53a085def1';

update public.lead_processes
   set deleted_at = now()
 where id = 'd55c896e-b96f-4415-a4d5-23417da136a5';

-- 2. CASO 2 — o CNJ certo herda o cuidado -------------------------------------
-- Aqui o process_title carrega o proprio erro: "1505819-97.2025.8.26.03788".
-- Mover sem reescrever deixaria o numero torto vivo no card da atividade.
update public.lead_activities
   set process_id    = 'ab73a87e-ef9e-44e4-8fa8-706423d7436a',
       process_title = '1505819-97.2025.8.26.0378 - INQUÉRITO POLICIAL'
 where process_id = 'a3d2f961-8161-4e98-9c8f-be22590fc3fe';

update public.lead_processes
   set title = 'INQUÉRITO POLICIAL',
       responsible_user_id = coalesce(
         responsible_user_id,
         (select responsible_user_id from public.lead_processes
           where id = 'a3d2f961-8161-4e98-9c8f-be22590fc3fe'))
 where id = 'ab73a87e-ef9e-44e4-8fa8-706423d7436a';

update public.lead_processes
   set deleted_at = now()
 where id = 'a3d2f961-8161-4e98-9c8f-be22590fc3fe';

-- 2b. A ultima movimentacao nao se recalcula sozinha aqui ---------------------
-- lead_processes_avanca_ultima_movimentacao roda AFTER INSERT em
-- process_updates. Mover linha e UPDATE: o gatilho nao dispara, e a ficha que
-- fica continuaria com a data de antes da fusao. Recalculo pelo feed, com a
-- mesma regra do gatilho (data presumida e chute do parser, e data no futuro
-- nao vale).
update public.lead_processes lp
   set data_ultima_movimentacao = to_char(f.mais_recente, 'YYYY-MM-DD')
  from (
    select process_id, max(data_movimentacao) as mais_recente
      from public.process_updates
     where process_id in ('13d685de-df16-4f38-8163-6e53a085def1',
                          'ab73a87e-ef9e-44e4-8fa8-706423d7436a')
       and not coalesce(data_presumida, false)
       and data_movimentacao <= current_date
     group by process_id
  ) f
 where lp.id = f.process_id
   and coalesce(public.data_iso_ou_nulo(lp.data_ultima_movimentacao), '-infinity'::date)
       < f.mais_recente;

-- 3. A porta que deixou o 21º dígito entrar -----------------------------------
create or replace function public.lead_processes_numero_valido()
returns trigger
language plpgsql
as $function$
declare
  v_digitos    text;
  v_esperado   text;
  v_cara_de_cnj boolean;
begin
  -- Só confere quando o número muda. Editar o título de uma ficha antiga com
  -- número torto tem que continuar funcionando: foi o erro do gatilho
  -- anti-duplicata, que congelou 100 fichas sem ninguém perceber.
  if tg_op = 'UPDATE'
     and new.process_number is not distinct from old.process_number then
    return new;
  end if;

  -- Espaço nas pontas e vazio viram nulo. "Sem número" é resposta honesta.
  new.process_number := nullif(btrim(coalesce(new.process_number, '')), '');
  if new.process_number is null then
    return new;
  end if;

  v_digitos := public.cnj_digitos(new.process_number);

  -- Anotação não é número.
  if v_digitos is null then
    raise exception using
      errcode = '23514',
      message = format('"%s" não é um número de processo.', new.process_number),
      detail  = 'O campo do número não tem um dígito sequer — é uma anotação.',
      hint    = 'Deixe o número em branco e escreva a observação no título ou nas notas do caso. Ficha sem número é normal; ficha com recado no lugar do número faz o sistema casar este caso com o processo de outro cliente.';
  end if;

  -- Escrito na máscara do CNJ? Então tem que ser um CNJ. Conferir pela FORMA e
  -- não só pelo tamanho é o que pega o dígito a mais: 1505819-97.2025.8.26.03788
  -- tem 21 dígitos, escapou da trava anti-duplicata (que exige exatamente 20) e
  -- virou uma segunda ficha do mesmo processo no mesmo cliente.
  -- Quem não está nessa máscara segue livre: NB, protocolo, BO e o procedimento
  -- do MP 02.16.0079.0389620/2026-57, que tem 21 dígitos e é legítimo.
  v_cara_de_cnj := new.process_number ~ '^[0-9]+-[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$';

  if (length(v_digitos) = 20 or v_cara_de_cnj)
     and not public.cnj_valido(new.process_number) then

    if length(v_digitos) <> 20 then
      raise exception using
        errcode = '23514',
        message = format('CNJ inválido: %s', new.process_number),
        detail  = format('Está escrito no formato de CNJ mas tem %s dígitos, e CNJ tem 20.', length(v_digitos)),
        hint    = 'Confira o número na fonte — quase sempre é um dígito a mais ou a menos no fim. Se não for CNJ, escreva sem a pontuação de CNJ (protocolo, NB e boletim de ocorrência entram normalmente).';
    end if;

    v_esperado := lpad(((98 - ((substr(v_digitos,1,7) || substr(v_digitos,10,4) ||
                                substr(v_digitos,14,1) || substr(v_digitos,15,2) ||
                                substr(v_digitos,17,4) || '00')::numeric % 97))::int)::text, 2, '0');
    raise exception using
      errcode = '23514',
      message = format('CNJ inválido: %s', new.process_number),
      detail  = format('O dígito verificador não fecha. Para este número o correto seria %s, e não %s.',
                       v_esperado, substr(v_digitos, 8, 2)),
      hint    = 'Confira o número na fonte. CNJ com verificador errado entra no sistema, mas o tribunal e o Escavador recusam — e a ficha fica girando na fila sem ninguém entender por quê.';
  end if;

  -- CNJ bom vira forma canônica. O resto (NB, protocolo, BO) passa aparado.
  if length(v_digitos) = 20 then
    new.process_number := public.cnj_formatado(new.process_number);
  end if;

  return new;
end $function$;
