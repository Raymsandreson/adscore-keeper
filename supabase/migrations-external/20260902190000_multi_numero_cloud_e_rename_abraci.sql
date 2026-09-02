-- Multi-número na WhatsApp Cloud API + renomeia a linha atual para `abraci`.
--
-- POR QUE: `whatsapp_cloud_config` era singleton e o nome da linha vivia
-- hardcoded como 'cloud_gerencia' em ~20 pontos do código. Com um segundo
-- número (Prudêncio Advogados), "a config ativa" deixa de identificar quem
-- enviou e quem recebeu — e `maybeSingle()` no envio passaria a ERRAR com duas
-- linhas ativas.
--
-- ORDEM OBRIGATÓRIA: o código que reconhece os dois nomes (`cloud_gerencia` e
-- `abraci`) já tem que estar em produção quando este arquivo rodar. Rodar antes
-- disso faz a tela deixar de reconhecer a conversa como Cloud e tentar enviar
-- pela UazAPI.
--
-- ROLLBACK (testado como simétrico, sem perda):
--   update public.whatsapp_messages        set instance_name='cloud_gerencia' where instance_name='abraci';
--   update public.whatsapp_cloud_assignees set instance_name='cloud_gerencia' where instance_name='abraci';
--   update public.whatsapp_instances       set instance_name='cloud_gerencia' where instance_name='abraci';
--   update public.whatsapp_cloud_config    set instance_name=null where instance_name='abraci';

-- 1) Cada linha Cloud ganha nome, o mesmo `instance_name` de whatsapp_messages.
alter table public.whatsapp_cloud_config
  add column if not exists instance_name text;

-- Nulo continua permitido de propósito: linhas históricas inativas não têm nome,
-- e a tela de config (edge whatsapp-cloud-admin) ainda não manda o campo — com
-- NOT NULL, salvar por lá passaria a falhar.
create unique index if not exists whatsapp_cloud_config_instance_name_key
  on public.whatsapp_cloud_config (lower(instance_name))
  where instance_name is not null;

-- 2) A linha ativa hoje é a da ABRACI (+55 86 8900-9137, pnid 476046652256047).
update public.whatsapp_cloud_config
   set instance_name = 'abraci', updated_at = now()
 where is_active = true;

-- 3) Renomeia o dado histórico. Contagem medida em 02/09/2026 antes de rodar:
--      whatsapp_messages         674
--      whatsapp_cloud_assignees   75
--      whatsapp_instances          1
--    Nenhuma das outras 26 tabelas com coluna instance_name tem linha com esse
--    nome (varredura por count exato em todas elas).
update public.whatsapp_messages        set instance_name = 'abraci' where instance_name = 'cloud_gerencia';
update public.whatsapp_cloud_assignees set instance_name = 'abraci' where instance_name = 'cloud_gerencia';
update public.whatsapp_instances       set instance_name = 'abraci' where instance_name = 'cloud_gerencia';
