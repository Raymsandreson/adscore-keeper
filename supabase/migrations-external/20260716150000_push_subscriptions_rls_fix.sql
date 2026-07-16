-- Correção: a sessão externa do front é anônima (signInAnonymously), então
-- auth.uid() nunca é igual ao user.id do Cloud gravado em user_id. As policies
-- "por dono" (auth.uid() = user_id) bloqueavam TODOS os inserts → nenhuma
-- assinatura era salva. Espelha o padrão do team_chat_messages: aberto ao papel
-- authenticated. O envio real usa service_role (Railway), que ignora RLS.

drop policy if exists push_subs_select_own on public.push_subscriptions;
drop policy if exists push_subs_insert_own on public.push_subscriptions;
drop policy if exists push_subs_update_own on public.push_subscriptions;
drop policy if exists push_subs_delete_own on public.push_subscriptions;

drop policy if exists push_subs_authenticated_all on public.push_subscriptions;
create policy push_subs_authenticated_all on public.push_subscriptions
  for all to authenticated using (true) with check (true);
