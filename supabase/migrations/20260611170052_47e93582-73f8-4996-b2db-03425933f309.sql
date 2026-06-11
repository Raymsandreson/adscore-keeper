ALTER TABLE public.wjia_command_shortcuts
  ADD COLUMN IF NOT EXISTS handoff_config jsonb;

COMMENT ON COLUMN public.wjia_command_shortcuts.handoff_config IS
  'Config opcional de handoff humano: { mode: "transparent"|"disguised", fallback_order: ["process_responsible","case_acolhedor","lead_owner"], deadline: "end_of_day"|"+2h"|"+4h"|"next_business_day", end_of_day_hour: 18, notify_internal_chat: bool, phrases: { retorno, ligacao, reuniao, fechamento } }. NULL = comportamento antigo.';