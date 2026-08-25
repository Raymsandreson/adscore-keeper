-- Detecção do pedido de parada direto no banco — 25/08/2026.
-- Aplicar no Supabase Externo (kmedldlepwiityjsdahz).
--
-- POR QUE NO BANCO E NÃO NO WEBHOOK:
--   O plano original era detectar dentro da edge `whatsapp-webhook`. Ao comparar
--   o que está deployado com o repo, apareceram duas coisas:
--     1. o webhook em produção está ATRASADO — tem 2 correções commitadas em
--        02/07 que nunca subiram (guarda de JID de grupo virando contato/lead e
--        reconciliação anti-duplicidade de lead do CTWA). Subir o repo levaria
--        junto mudança de terceiro não validada nesta sessão;
--     2. o arquivo tem 158 mil caracteres, e a única via de deploy disponível
--        aqui exige reescrever o arquivo inteiro — risco alto de corromper a
--        função que recebe TODA mensagem do escritório.
--
--   A trigger faz o mesmo trabalho sem tocar em nenhuma das duas coisas, e sai
--   melhor: pega a mensagem por onde quer que ela tenha sido gravada, não só
--   pelo caminho do webhook. Tudo local — nenhuma chamada HTTP, nada para
--   autenticar, nada que possa falhar por rede.
--
-- O QUE NÃO É COBERTO AQUI:
--   A telemetria de entrega (`messages_update`/`message_ack`) continua pendente:
--   esses eventos são descartados pelo webhook ANTES de qualquer gravação, então
--   não existe INSERT em que uma trigger possa se pendurar. Segue precisando do
--   deploy do webhook, que fica para quando houver via segura (PAT + script).
--
-- ROLLBACK (<1min):
--   drop trigger trg_wa_optout_detecta_inbound on public.whatsapp_messages;
--   drop function public.wa_optout_detecta_inbound();
--   drop function public.wa_texto_pede_parada(text);

-- 1) O reconhecedor. Espelha `pediuParaParar` de supabase/functions/_shared/optout.ts
--    (testado em src/lib/__tests__/whatsappOptout.test.ts) — mudar um exige mudar o outro.
--
--    Deliberadamente ESTREITO: deixar passar um pedido custa uma mensagem a mais
--    e a equipe ainda pode marcar à mão; reconhecer errado apaga um lead vivo do
--    funil. Por isso "sair" e "parar" só valem como mensagem INTEIRA — "vou sair
--    do trabalho agora" e "pode parar na esquina" não podem fechar atendimento.
create or replace function public.wa_texto_pede_parada(txt text)
returns boolean
language sql
immutable
as $$
  select case
    when txt is null then false
    when btrim(txt) = '' then false
    when length(btrim(txt)) > 160 then false  -- desabafo longo não é comando de saída
    when btrim(txt) ~* '^(sair|parar|pare|para|stop|cancelar|descadastrar|remover|sai fora)[.!]?$' then true
    -- Como a recusa realmente aparece nesta base: os quatro padrões abaixo
    -- saíram de ler 90 dias de mensagens recebidas (66.253 inbound curtas).
    -- "sair"/"pare"/"stop" sozinhos: ZERO ocorrências. "não tenho interesse":
    -- 16. "não quero" no fim: 7. "não quero prosseguir/continuidade": 6.
    when btrim(txt) ~* 'n[ãa]o\s+tenho\s+(mais\s+)?interesse' then true
    when btrim(txt) ~* 'n[ãa]o\s+quero\s*(mais)?\s*[.!]?$' then true
    when btrim(txt) ~* 'n[ãa]o\s+quero\s+(mais\s+|ma[si]\s+)?(dar\s+continuidade|prosseguir|continuar|seguir)\y' then true
    when btrim(txt) ~* '^\s*sem\s+interesse' then true
    when btrim(txt) ~* 'n[ãa]o\s+(quero|desejo)\s+(mais\s+)?(receber|nada|ser\s+contatad)' then true
    when btrim(txt) ~* 'n[ãa]o\s+(me\s+)?(mand[ea]|envie|manda)\s+mais' then true
    when btrim(txt) ~* 'par[ea]\s+de\s+(me\s+)?(mandar|enviar|encher|perturbar)' then true
    when btrim(txt) ~* 'me\s+(tir[ea]|remov[ae]|exclu[ai])\s+(dess[ae]|d[ao])\s+(lista|grupo|cadastro)' then true
    when btrim(txt) ~* '(remov|exclu|apagu?)[a-z]*\s+meu\s+(n[úu]mero|contato|cadastro)' then true
    when btrim(txt) ~* 'me\s+dei?x[ea]\s+em\s+paz' then true
    when btrim(txt) ~* 'vou\s+denunciar' then true
    else false
  end;
$$;

comment on function public.wa_texto_pede_parada(text) is
  'Reconhece pedido de parada em mensagem recebida. Espelha pediuParaParar() de _shared/optout.ts.';

-- 2) A trigger. Sai cedo no caso comum (99% das mensagens) para não pesar:
--    testa direção e tamanho antes de qualquer regex.
create or replace function public.wa_optout_detecta_inbound()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_digitos text;
  v_key     text;
begin
  if NEW.direction is distinct from 'inbound' then return NEW; end if;
  if NEW.message_text is null or btrim(NEW.message_text) = '' then return NEW; end if;
  if length(NEW.message_text) > 160 then return NEW; end if;

  -- Grupo não gera opt-out individual: JID de grupo tem 17+ dígitos.
  v_digitos := regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g');
  if length(v_digitos) < 10 or length(v_digitos) > 15 then return NEW; end if;

  if not public.wa_texto_pede_parada(NEW.message_text) then return NEW; end if;

  v_key := public.wa_optout_key(NEW.phone);
  if v_key is null then return NEW; end if;

  -- Registra o pedido. Já existindo opt-out ativo, não faz nada de novo.
  insert into public.whatsapp_optouts
    (phone_key, phone_raw, instance_name, lead_id, source, reason, message_text)
  values
    (v_key, NEW.phone, NEW.instance_name, NEW.lead_id, 'whatsapp_text',
     'Pediu por mensagem para não receber mais contato', NEW.message_text)
  on conflict (phone_key) where revoked_at is null do nothing;

  -- Fecha os leads abertos (status 'refused' — ver migration 20260824140000).
  perform public.wa_optout_fecha_leads(
    v_key,
    'Pediu para não receber mais mensagens (opt-out WhatsApp)',
    'refused',
    NEW.lead_id
  );

  -- Desliga agente de IA e follow-up na conversa. Sem isto o
  -- wjia-followup-processor volta a cutucar quem acabou de pedir para sair.
  update public.whatsapp_conversation_agents
     set is_active = false, is_blocked = true
   where phone = v_digitos
     and (NEW.instance_name is null or instance_name = NEW.instance_name);

  return NEW;
exception when others then
  -- Nunca derrubar a gravação da mensagem por causa disto.
  raise warning 'wa_optout_detecta_inbound falhou para msg %: %', NEW.id, SQLERRM;
  return NEW;
end;
$$;

drop trigger if exists trg_wa_optout_detecta_inbound on public.whatsapp_messages;
create trigger trg_wa_optout_detecta_inbound
  after insert on public.whatsapp_messages
  for each row execute function public.wa_optout_detecta_inbound();
