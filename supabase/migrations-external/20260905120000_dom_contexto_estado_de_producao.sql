-- =============================================================================
-- RECONSTITUIÇÃO — o que foi aplicado em produção em 05/09/2026 e não tinha
-- arquivo no repositório.
--
-- Estas funções foram criadas direto no banco durante a sessão de 05/09 e
-- ficaram só lá. O repositório não sabia que existiam: uma sessão futura leria
-- `dom_contexto_processual` na versão de 04/09 e concluiria, errado, que fase,
-- documentos e atividade não chegam ao prompt.
--
-- Este arquivo existe para fechar essa distância. Ele é `create or replace`,
-- então reaplicá-lo é seguro e não muda nada se o banco já estiver assim.
--
-- Ordem: este arquivo é o ESTADO INTERMEDIÁRIO. A versão final de
-- `dom_contexto_processual` está em 20260905203000_dom_ultima_movimentacao_real,
-- que roda depois e é o rollback-alvo daquela.
-- =============================================================================

-- 1. Tira HTML da anotação da atividade -------------------------------------
-- A nota é escrita em editor rico e saía do banco como `<p class="lexical-
-- paragraph">` direto para o prompt. Modelo imita o que recebe.
-- Limpeza na origem, preservando as quebras de parágrafo.
create or replace function public.dom_texto_limpo(p_html text)
returns text
language sql
immutable
as $function$
  select nullif(btrim(
    regexp_replace(
      replace(replace(replace(replace(replace(
        -- <br> e </p> viram quebra de linha antes de as tags sumirem, senão
        -- parágrafos diferentes grudam numa frase só.
        regexp_replace(coalesce(p_html, ''), '<\s*(br|/p|/div|/li)\s*/?\s*>', E'\n', 'gi'),
        '&nbsp;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'),
      '<[^>]*>', '', 'g'),
    E' \t\n\r'), '');
$function$;

-- 2. Quem o tique deve olhar -------------------------------------------------
-- Com 8 grupos dava para varrer todos. Com 1149, `select ... limit 8` sem
-- ordenação olharia sempre os mesmos oito e os outros nunca — o piloto
-- pareceria funcionar e a maior parte dos clientes ficaria calada.
--
-- A conta vira do avesso: parte das MENSAGENS e devolve só grupo onde o
-- CLIENTE falou DEPOIS da última decisão, o mais recente primeiro. Grupo
-- parado não custa nada.
create or replace function public.dom_grupos_para_olhar(
  p_limite integer default 20,
  p_janela interval default '48:00:00'::interval
)
returns table(group_jid text, group_name text, lead_id uuid, modo text,
              ultima_do_cliente timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with do_cliente as (
    select m.phone, max(m.created_at) as quando
      from public.whatsapp_messages m
     where m.created_at > now() - p_janela
       and coalesce((m.metadata -> 'message' ->> 'fromMe')::boolean, false) = false
       -- Mensagem da equipe chega como inbound para os OUTROS números nossos
       -- que estão no grupo. Sem este filtro o assessor responderia colega.
       and not exists (
         select 1
           from public.dom_numeros_equipe e
          where e.ativo
            and e.phone = regexp_replace(
              coalesce(m.metadata -> 'message' ->> 'sender_pn',
                       m.metadata -> 'message' ->> 'sender', ''),
              '\D', '', 'g')
       )
     group by m.phone
  )
  select g.group_jid, g.group_name, g.lead_id, g.modo, c.quando
    from public.dom_grupos_piloto g
    join do_cliente c on c.phone = g.group_jid
   where g.ativo
     and c.quando > coalesce(
           (select max(d.criado_em) from public.dom_decisoes d
             where d.group_jid = g.group_jid),
           '-infinity'::timestamptz)
   order by c.quando desc
   limit greatest(p_limite, 1);
$function$;

-- 3. O rascunho de áudio ------------------------------------------------------
-- O cliente manda áudio e recebe texto: quebra o ritmo. Mas voz errada sobre o
-- processo de alguém não tem como desdizer — então o áudio nasce como rascunho
-- e espera liberação humana. Nem em grupo automático ele sai.
alter table public.dom_respostas_pendentes
  add column if not exists audio_url  text,
  add column if not exists audio_voz  text,
  add column if not exists audio_erro text;

comment on column public.dom_respostas_pendentes.audio_url is
  'Audio gerado do rascunho. NUNCA e enviado sozinho: espera liberacao humana no painel.';
comment on column public.dom_respostas_pendentes.audio_erro is
  'Motivo de o audio nao ter saido. Falha de audio nunca derruba o rascunho de texto.';

-- 4. O gênero da voz chega ao modelo ------------------------------------------
-- Morava no banco e não entrava no prompt. Em texto ninguém nota; falado por
-- uma voz de mulher, "obrigado" soa errado na hora — e o primeiro áudio gerado
-- saiu exatamente assim.
alter table public.wjia_command_shortcuts
  add column if not exists genero_voz text;

comment on column public.wjia_command_shortcuts.genero_voz is
  'feminina | masculina. Entra no system prompt para o texto combinar com a voz do TTS.';
