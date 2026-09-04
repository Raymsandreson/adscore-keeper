-- Nome do cliente resolvido por cascata determinística.
--
-- 26% dos leads vivos (5.066 de 19.419, medido em 04/09/2026) carregam no
-- lead_name um código de dossiê no lugar do nome de alguém: "LEAD314",
-- "PREV 1512 - ( ) Acd- -", ou só o telefone. Desses, 995 têm grupo de WhatsApp
-- — são clientes de verdade, com atendimento em curso e ficha sem nome.
--
-- O nome existe: 848 dos 995 têm ao menos uma fonte determinística (procuração
-- assinada, contato cadastrado, título real do grupo, requerimento do INSS).
-- Estas colunas guardam o resultado dessa busca SEM tocar em lead_name.
--
-- Por que coluna nova e não corrigir o lead_name:
--  1. lead_name é rótulo operacional. Ele carrega número do dossiê, cidade e
--     acolhedor de propósito, e a sequência do funil depende do formato.
--  2. Em 145 dos 698 casos comparáveis o número do lead diverge do número no
--     título do grupo, e em 114 desses existe OUTRO lead vivo com o número do
--     título. Escrever o nome do grupo por cima carimbaria o cliente errado.
--  3. victim_name não serve de atalho: no BPC a mãe é o lead e a criança é a
--     beneficiária ("Aline" → "Sophia"). São duas pessoas, não duas grafias.
--
-- Reversível: `alter table public.leads drop column ...` nas três.

alter table public.leads
  add column if not exists client_name_resolved text,
  add column if not exists client_name_source text,
  add column if not exists client_name_resolved_at timestamptz;

comment on column public.leads.client_name_resolved is
  'Nome do cliente achado por cascata determinística (resolve-client-names). Nunca sobrescreve lead_name; a tela mostra os dois.';
comment on column public.leads.client_name_source is
  'De onde veio: procuracao | contato | titulo_grupo | inss. Sem fonte declarada o valor não vale nada — não preencher à mão.';
comment on column public.leads.client_name_resolved_at is
  'Quando a cascata rodou. Serve para reprocessar só o que envelheceu.';
