-- Padroniza o acolhedor do lead: de texto livre para user_id.
--
-- POR QUE
-- leads.acolhedor é texto livre e acumulou 56 grafias para ~25 pessoas. A porta
-- de entrada é o CadastrarCasoViavelDialog:
--
--   <SelectItem value={p.full_name || p.email || p.id}>
--
-- Esse || em cascata grava TRÊS formatos na mesma coluna conforme o que o perfil
-- tem preenchido: nome completo, senão o e-mail, senão o UUID cru. É por isso que
-- existem 73 leads com e-mail no campo e 1 com um UUID solto. Confirmado: os
-- e-mails batem com as pessoas certas (jruniaosa@ é o João Pedro, edilansantos163@
-- é o Edilan), então não era lixo — era a mesma pessoa escrita de outro jeito.
--
-- O QUE MUDA
-- acolhedor_user_id passa a ser a fonte da verdade. O texto continua existindo
-- (uns 20 lugares leem ele: AgentMonitorDashboard, useMonitorFilters, relatórios,
-- vw_leads_acolhimento, lead_list_view) mas é normalizado para uma grafia só por
-- pessoa — hoje "Karolyne" e "Maria Karolyne de Aguiar Nunes" são duas linhas em
-- todo relatório.
--
-- Reatribuições pedidas pelo Raym em 04/08/2026:
--   Luiz Abraci  → Luiz Ricardo   (Luiz Abraci é nome de INSTÂNCIA, e é a
--                                  instância padrão do Luiz Ricardo)
--   Dom          → Analyne
--   Andreia      → rodízio entre Israel, Mateus, Edilan e Karolyne
--
-- Andreia saiu da equipe e seus 54 leads são de um único board, num intervalo de
-- 30 dias — não há sinal no dado que diga quem herda qual. O rodízio é por ordem
-- de criação, determinístico e reproduzível, mas é ARBITRÁRIO por natureza: se a
-- divisão real for outra, refaça a partir do backup abaixo.
--
-- ROLLBACK
--   update public.leads l set acolhedor = b.acolhedor_old, acolhedor_user_id = null
--     from public.bkp_acolhedor_padronizacao_20260804 b where b.lead_id = l.id;
--   alter table public.leads drop column acolhedor_user_id;

-- ---------------------------------------------------------------------------
-- 0) Rota de fuga: guarda o valor antigo de TODO lead que tem acolhedor
-- ---------------------------------------------------------------------------
create table if not exists public.bkp_acolhedor_padronizacao_20260804 as
select id as lead_id, acolhedor as acolhedor_old, now() as backup_at
from public.leads
where acolhedor is not null and btrim(acolhedor) <> '';

-- ---------------------------------------------------------------------------
-- 1) A coluna que passa a valer
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists acolhedor_user_id uuid;

create index if not exists idx_leads_acolhedor_user
  on public.leads(acolhedor_user_id)
  where acolhedor_user_id is not null;

comment on column public.leads.acolhedor_user_id is
  'Acolhedor do lead (user_id). Fonte da verdade. A coluna acolhedor (texto) '
  'segue existindo como rótulo para relatórios e filtros legados.';

-- ---------------------------------------------------------------------------
-- 2) De-para explícito
-- ---------------------------------------------------------------------------
-- O destino é resolvido por E-MAIL, não por UUID: e-mail é estável, único
-- (verificado: zero duplicado em profiles) e legível na revisão do código.
-- nome_canonico é escolhido à mão porque profiles.full_name está velho para
-- alguns ("analyne.sousa71", "luisralves7@gmail.com" no lugar do nome).
with mapa(valor, email_destino, nome_canonico) as (values
  ('Karolyne',                             'karolynenunes2003@gmail.com',      'Maria Karolyne de Aguiar Nunes'),
  ('Analyne Sousa de Oliveira',            'analyne.sousa71@gmail.com',        'Analyne Sousa de Oliveira'),
  ('Analyne',                              'analyne.sousa71@gmail.com',        'Analyne Sousa de Oliveira'),
  ('analyne.sousa71@gmail.com',            'analyne.sousa71@gmail.com',        'Analyne Sousa de Oliveira'),
  ('Dom',                                  'analyne.sousa71@gmail.com',        'Analyne Sousa de Oliveira'),
  ('edilansantos163@gmail.com',            'edilansantos163@gmail.com',        'Edilan da Silva Santos'),
  ('Viviane Amorin',                       'viviane.amorin88@gmail.com',       'Viviane Amorim'),
  ('Dra. Luana Barros l',                  'luana.barroscs@gmail.com',         'Luana Barros'),
  ('Raymsandreson de Morais Prudêncio',    'raymsandresonadv@gmail.com',       'Raymsandreson de Morais Prudêncio'),
  ('Dr. Prudêncio',                        'raymsandresonadv@gmail.com',       'Raymsandreson de Morais Prudêncio'),
  ('Raym',                                 'raymsandresonadv@gmail.com',       'Raymsandreson de Morais Prudêncio'),
  ('raymsandresonadv@gmail.com',           'raymsandresonadv@gmail.com',       'Raymsandreson de Morais Prudêncio'),
  ('jruniaosa@gmail.com',                  'jruniaosa@gmail.com',              'João Pedro Alvarenga Pereira de Sá'),
  ('João Pedro',                           'jruniaosa@gmail.com',              'João Pedro Alvarenga Pereira de Sá'),
  ('Joao Pedro Alvarenga Pereira de Sá',   'jruniaosa@gmail.com',              'João Pedro Alvarenga Pereira de Sá'),
  ('crisleyoliveira1978@outlook.com',      'crisleyoliveira1978@outlook.com',  'Crisley Costa de Oliveira'),
  ('Keilane atendimento',                  'keilane.lima196@gmail.com',        'Keilane de Lima Teixeira'),
  ('Pablo kauan',                          'kauanalbarl@gmail.com',            'Pablo Kauan de Albuquerque Arealeão'),
  ('Pablo Kauan de Albuquerque Area leão', 'kauanalbarl@gmail.com',            'Pablo Kauan de Albuquerque Arealeão'),
  ('João Manoel',                          'joao.abraci@gmail.com',            'João Manoel Cavalcante Santana'),
  ('Luiz Abraci',                          'luisralves7@gmail.com',            'Luiz Ricardo'),
  ('Luiz Ricardo',                         'luisralves7@gmail.com',            'Luiz Ricardo')
)
update public.leads l
   set acolhedor_user_id = p.user_id,
       acolhedor         = m.nome_canonico
  from mapa m
  join public.profiles p on lower(p.email) = m.email_destino
 where btrim(l.acolhedor) = m.valor;

-- ---------------------------------------------------------------------------
-- 3) Andreia → rodízio entre os quatro
-- ---------------------------------------------------------------------------
with destinos as (
  select p.user_id, p.full_name, v.ord - 1 as slot
    from (values ('israelcarvalho079@gmail.com',   1),
                 ('mateussaraiva.juridico@gmail.com', 2),
                 ('edilansantos163@gmail.com',     3),
                 ('karolynenunes2003@gmail.com',   4)) v(email, ord)
    join public.profiles p on lower(p.email) = v.email
),
alvo as (
  select l.id, (row_number() over (order by l.created_at, l.id) - 1) % 4 as slot
    from public.leads l
   where btrim(l.acolhedor) = 'Andreia'
)
update public.leads l
   set acolhedor_user_id = d.user_id,
       acolhedor         = d.full_name
  from alvo a
  join destinos d on d.slot = a.slot
 where l.id = a.id;

-- ---------------------------------------------------------------------------
-- 4) O resto que já resolve sozinho
-- ---------------------------------------------------------------------------
-- Aqui o texto vira profiles.full_name de propósito: são os casos em que o valor
-- já era o nome completo (não muda nada) ou um primeiro nome não-ambíguo, que
-- passa a ser a grafia cheia — fundindo "Mateus" com "Mateus Santos Saraiva".
update public.leads l
   set acolhedor_user_id = p.user_id,
       acolhedor         = p.full_name
  from public.profiles p
 where l.acolhedor_user_id is null
   and l.acolhedor is not null
   and btrim(l.acolhedor) <> ''
   and p.user_id = public.wa_resolve_acolhedor(l.acolhedor)
   and p.full_name is not null
   and btrim(p.full_name) <> '';

-- Sobram de propósito, com acolhedor_user_id nulo: nomes de instância
-- ("Atendimento Previdenciário", "WhatsJUD IA"), origem de campanha ("anúncio"),
-- um UUID órfão e o apelido "jp", que eu não sei de quem é. Nada disso é pessoa
-- identificável, e chutar destinatário de conversa de cliente é pior que deixar
-- sem.
