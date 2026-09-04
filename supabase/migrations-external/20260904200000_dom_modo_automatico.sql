-- =============================================================================
-- O atendente virtual passa a AGENDAR, em vez de só rascunhar.
--
-- Antes: o rascunho ficava em `dom_respostas_pendentes` esperando alguém
-- aprovar. Ninguém aprovava, e por isso a conversa nunca mostrava nada — a
-- bolha tracejada com o cronômetro lê `whatsapp_mensagens_agendadas`, e o Dom
-- nunca escrevia lá.
--
-- Agora, em grupo com `modo = 'automatico'`, o rascunho vira uma linha da MESMA
-- fila de agendamento que a equipe já usa há tempo. Com isso ele ganha de
-- graça, sem código novo:
--   · a bolha tracejada na conversa, com contagem regressiva;
--   · o "tirar da fila" e o "enviar agora" da própria bolha;
--   · `pular_se_responder` — se alguém (cliente OU colega) escrever no grupo
--     dentro dos 5 minutos, a resposta não sai. Rascunho velho não fala.
--   · o disparo pelo banco, que roda com o computador de todo mundo desligado.
--
-- É a janela de 5 minutos que faz o papel da revisão: silêncio aprova.
--
-- ROLLBACK (menos de 1 minuto, sem perda):
--   update dom_grupos_piloto set modo = 'rascunho';   -- para de agendar
--   update whatsapp_mensagens_agendadas set ativo = false
--    where criado_por_nome = 'Atendente virtual' and ativo;  -- esvazia a fila
-- =============================================================================

-- 1. O elo entre o rascunho e a linha que vai sair. Nulo = não foi agendado.
alter table public.dom_respostas_pendentes
  add column if not exists agendamento_id uuid;

comment on column public.dom_respostas_pendentes.agendamento_id is
  'Linha de whatsapp_mensagens_agendadas criada por este rascunho. Nulo = ainda nao vai sair sozinho.';

create index if not exists idx_dom_pendentes_agendamento
  on public.dom_respostas_pendentes (agendamento_id)
  where agendamento_id is not null;

-- 2. Saiu de verdade → o painel para de mostrar como "na fila".
--    Sem isto o rascunho ficaria eternamente pendente mesmo depois de chegar ao
--    cliente, e a coluna "Enviadas" continuaria mentindo que está vazia.
create or replace function public.dom_marcar_enviada_pelo_agendamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.ultimo_envio_at is distinct from old.ultimo_envio_at
     and new.ultimo_envio_at is not null then
    update public.dom_respostas_pendentes
       set status     = 'enviada',
           enviado_em = new.ultimo_envio_at
     where agendamento_id = new.id
       and status = 'pendente';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dom_marcar_enviada on public.whatsapp_mensagens_agendadas;
create trigger trg_dom_marcar_enviada
  after update on public.whatsapp_mensagens_agendadas
  for each row
  execute function public.dom_marcar_enviada_pelo_agendamento();
