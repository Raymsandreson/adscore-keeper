-- Dono da conversa (assignee) para todas as instâncias, não só a cloud_gerencia.
--
-- POR QUE
-- O push de mensagem nova hoje deduz o destinatário de atributos do CLIENTE
-- (responsável do processo, acolhedor) ou da LINHA (dono da instância). Nenhum
-- dos dois diz quem está de fato cuidando daquela conversa. Isso cria dois
-- buracos medidos na base em 06/08/2026:
--
--   * instância compartilhada (Atendimento Previdenciário e cia, ~12,4 mil
--     mensagens/semana) não tem um dono só — hoje as conversas privadas dela
--     não notificam ninguém;
--   * quando o cliente fala de dois processos com responsáveis diferentes
--     (9 leads hoje), não existe resposta certa derivada do dado.
--
-- A tabela whatsapp_cloud_assignees já modela exatamente o que falta — dono por
-- (phone, instance_name) — mas só é usada na cloud_gerencia (71 conversas).
-- Aqui ela é liberada para o resto: quem responde primeiro assume a conversa.
--
-- O QUE ESTA MIGRATION FAZ
-- Só abre as policies de escrita. Não move nem apaga nada; as 71 linhas da
-- cloud_gerencia seguem intactas e o comportamento atual dela não muda.
--
-- ROLLBACK
--   drop policy if exists wa_assignees_claim_self on public.whatsapp_cloud_assignees;
--   drop policy if exists wa_assignees_handoff on public.whatsapp_cloud_assignees;

-- Assumir a conversa.
--
-- NÃO dá para amarrar em auth.uid(): a sessão do front no Externo é ANÔNIMA
-- (external-client.ts chama signInAnonymously), então auth.uid() ali é um id
-- aleatório, nunca o do usuário no Cloud. A primeira versão desta policy exigia
-- auth.uid() = assigned_user_id e bloqueou 100% das tentativas em silêncio.
-- A identidade aqui vem da aplicação, como no resto desta base (o front já
-- escreve direto em whatsapp_instances do mesmo jeito).
drop policy if exists wa_assignees_claim_self on public.whatsapp_cloud_assignees;
create policy wa_assignees_claim_self on public.whatsapp_cloud_assignees
  for insert to authenticated
  with check (assigned_user_id is not null);

-- Handoff: passar a conversa adiante. Aqui o destino pode ser outra pessoa —
-- é o "esse assunto é do fulano, passa pra ele" que a equipe já faz na mão.
drop policy if exists wa_assignees_handoff on public.whatsapp_cloud_assignees;
create policy wa_assignees_handoff on public.whatsapp_cloud_assignees
  for update to authenticated
  using (true)
  with check (assigned_user_id is not null);

comment on table public.whatsapp_cloud_assignees is
  'Dono da conversa por (phone, instance_name). Quem responde primeiro assume; '
  'o push de mensagem nova prefere este dono a qualquer regra derivada do lead.';
