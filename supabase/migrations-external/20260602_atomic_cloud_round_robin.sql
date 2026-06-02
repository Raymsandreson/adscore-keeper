-- Round-robin atômico para distribuição de leads do WhatsApp Cloud (número de gerência).
--
-- Problema: a versão anterior fazia read-modify-write em JS (whatsapp-cloud-webhook.ts),
-- sem lock. Duas mensagens simultâneas liam o mesmo last_assigned_user_id e caíam no
-- mesmo atendente, furando o rodízio.
--
-- Solução: seleção + atualização em uma única transação, com SELECT ... FOR UPDATE na
-- linha de whatsapp_cloud_assignments. Concorrentes serializam na trava: o segundo só
-- prossegue depois do commit do primeiro, já lendo o índice atualizado.
--
-- A lógica de índice é idêntica à do JS legado:
--   - last NULL ou fora do pool  -> primeiro elemento (pool[1])
--   - last na posição p (1-based) -> (p % len) + 1  (com wrap no fim)
--
-- Banco: EXTERNO (kmedldlepwiityjsdahz). NÃO aplicar no Cloud.

CREATE OR REPLACE FUNCTION public.pick_cloud_assignee(p_rule_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pool     uuid[];
  v_last     uuid;
  v_len      int;
  v_last_idx int;
  v_next_idx int;
  v_next     uuid;
BEGIN
  -- Pool elegível vem da própria regra (fonte única de verdade).
  SELECT eligible_user_ids INTO v_pool
  FROM public.whatsapp_cloud_routing_rules
  WHERE id = p_rule_id;

  v_len := COALESCE(array_length(v_pool, 1), 0);
  IF v_len = 0 THEN
    RETURN NULL;
  END IF;

  -- Garante a linha de assignment e trava ela para serializar concorrentes.
  INSERT INTO public.whatsapp_cloud_assignments (rule_id, total_assigned, updated_at)
  VALUES (p_rule_id, 0, now())
  ON CONFLICT (rule_id) DO NOTHING;

  SELECT last_assigned_user_id INTO v_last
  FROM public.whatsapp_cloud_assignments
  WHERE rule_id = p_rule_id
  FOR UPDATE;

  -- array_position é 1-based e retorna NULL se não achar; COALESCE(...,0) trata
  -- "sem último" e "último não está mais no pool" como início do rodízio.
  v_last_idx := COALESCE(array_position(v_pool, v_last), 0);
  v_next_idx := (v_last_idx % v_len) + 1;
  v_next     := v_pool[v_next_idx];

  UPDATE public.whatsapp_cloud_assignments
  SET last_assigned_user_id = v_next,
      last_assigned_at      = now(),
      total_assigned        = total_assigned + 1,
      updated_at            = now()
  WHERE rule_id = p_rule_id;

  RETURN v_next;
END;
$$;
