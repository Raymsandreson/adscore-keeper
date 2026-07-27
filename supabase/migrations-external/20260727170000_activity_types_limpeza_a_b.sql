-- Limpeza de activity_types — baldes A (apagar 0/0) e B (merge duplicado de rotina).
-- Banco: EXTERNO (kmedldlepwiityjsdahz). Decisão do usuário (jul/2026).
-- Regra: só apaga tipo com 0 lead_activities E 0 blocos de rotina. Duplicado usado em
-- rotina é MERGE (repontar user_timeblock_settings), nunca delete puro.

-- Balde B — Almoço: canônico custom_1784048442081 ("Almoço"). Repoint dos 2 duplicados
-- (almoço/ALMOÇO) na rotina antes de apagar (0 atividades, só rotina).
update public.user_timeblock_settings
  set activity_type = 'custom_1784048442081'
  where activity_type in ('custom_1784041650378', 'custom_1784751440207');

delete from public.activity_types
  where key in ('custom_1784041650378', 'custom_1784751440207'); -- almoço, ALMOÇO

-- Balde A — apagar direto (0 atividades / 0 rotina).
delete from public.activity_types
  where key in ('custom_1779225094711', 'custom_1779225265880'); -- Urgência do dia, Recursos Adm
