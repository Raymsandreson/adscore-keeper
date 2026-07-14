-- Estações intermediárias na linha do processo (antes da sentença):
-- audiência de conciliação, perícia e audiência de instrução.
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- Rollback:
--   alter table public.process_movements drop constraint process_movements_tipo_movimentacao_check;
--   alter table public.process_movements add constraint process_movements_tipo_movimentacao_check
--     check (tipo_movimentacao = any (array['peticao_inicial','sentenca_1grau','acordo','acordao_2grau','acordao_superior','transito_julgado','pagamento']));
--   alter table public.lead_processes drop column if exists pericia_prevista;

-- Aceita os novos tipos de marco (evidência vinda do detector de compromissos
-- e do campo audiencias do Escavador).
alter table public.process_movements
  drop constraint if exists process_movements_tipo_movimentacao_check;

alter table public.process_movements
  add constraint process_movements_tipo_movimentacao_check
  check (tipo_movimentacao = any (array[
    'peticao_inicial', 'audiencia_conciliacao', 'pericia', 'audiencia_instrucao',
    'sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior',
    'transito_julgado', 'pagamento'
  ]::text[]));

-- Override manual da previsão de perícia na ficha do processo:
-- null = automático (regra por ramo/tipo de caso), true = prevista, false = não.
alter table public.lead_processes
  add column if not exists pericia_prevista boolean;
