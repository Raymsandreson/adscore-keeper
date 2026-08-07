# Identidade de usuário — os dois espaços de id

> Levantamento feito em 06/08/2026, medido no banco Externo (`kmedldlepwiityjsdahz`).
> Motivo: dois bugs de push que nasceram de gravar id do banco errado.

## O problema em uma frase

A mesma pessoa tem **dois `user_id` diferentes** — um no Cloud
(`gliigkupoebmlbwyvijp`, onde o login acontece) e outro no Externo. Em **26 dos
51 cadastros** os dois valores são diferentes. A tradução vive em
`auth_uuid_mapping (cloud_uuid, ext_uuid)`, que existe nos dois bancos.

A regra está no `src/integrations/supabase/uuid-remap.ts`:

> ANTES de qualquer insert/update no Externo que grave coluna de usuário,
> passar o valor por `remapToExternal()`.

Ler o arquivo não basta para não errar — quem escreveu este documento errou
duas vezes no mesmo dia depois de lê-lo. Por isso o mapa abaixo.

## Não é bagunça: são dois subsistemas coerentes

Cada tabela é consistente consigo mesma. O perigo está em **cruzar** os dois.

### Cluster NEGÓCIO — guarda id do **Externo**

| tabela | coluna | registros |
|---|---|---|
| `contacts` | `created_by` | 25.440 |
| `leads` | `created_by` | 2.876 |
| `leads` | `acolhedor_user_id` | 2.546 |
| `leads` | `processual_responsible_id` | 1.949 |
| `lead_processes` | `responsible_user_id` | 96 |
| `whatsapp_instances` | `owner_user_id` | 10 |
| `whatsapp_cloud_assignees` | `assigned_user_id` | 2 |

### Cluster EQUIPE / NOTIFICAÇÃO — guarda id do **Cloud**

| tabela | coluna | registros |
|---|---|---|
| `team_messages` | `sender_id` | 1.343 |
| `team_chat_messages` | `sender_id` | 318 |
| `team_conversation_members` | `user_id` | 169 |
| `org_user_status` | `user_id` | 17 |
| `push_subscriptions` | `user_id` | 15 |
| `team_managers` | `manager_user_id` | 9 |
| `member_time_off` | `user_id` | 4 |

> Contagens consideram só as 26 pessoas cujos ids diferem — são as únicas que
> discriminam. Quem tem `cloud_uuid = ext_uuid` não diz nada sobre qual espaço a
> tabela usa.

## A armadilha

Qualquer feature que **resolva alguém no cluster de negócio e notifique pelo
cluster de equipe** precisa traduzir no meio do caminho. Foi exatamente o que
quebrou o push de mensagem nova: ele resolvia o destinatário em
`whatsapp_instances.owner_user_id` (Externo) e procurava a inscrição em
`push_subscriptions` (Cloud). Para as 26 pessoas com ids diferentes, nenhuma
notificação era entregue — silenciosamente, porque a busca simplesmente não
achava linha.

A tradução vive em `railway-server/src/lib/whatsapp-push.ts` → `toCloudUserId()`.

## Linhas hoje com o id errado

| tabela | coluna | id do Cloud (errado) | id do Externo (certo) |
|---|---|---|---|
| `lead_activities` | `assigned_to` | **100** | 16.717 |
| `legal_cases` | `created_by` | **34** | 491 |

Efeito prático: 100 atividades estão atribuídas a um id que não existe no
Externo — não aparecem para a pessoa que deveria fazê-las. E 34 casos têm
autoria fantasma nos relatórios.

## Escritas no Externo sem passar pelo remap

Levantadas com varredura no `src/`: **25 escritas em 23 arquivos** gravam coluna
de usuário no Externo sem importar `remapToExternal`. A maioria é inofensiva
(grava em tabela do cluster Cloud, que é onde o valor deve mesmo ficar), mas
estas alimentam tabelas do cluster de negócio e são as candidatas a repetir o
bug:

- `src/components/kanban/LeadEditDialog.tsx` → `legal_cases.created_by`
- `src/components/finance/PendingTransactionsList.tsx` → `leads.created_by/updated_by`
- `src/components/finance/BankTransactionsView.tsx` → `leads.created_by/updated_by`
- `src/components/instagram/CaseSearchEngine.tsx` → `leads.created_by/updated_by`
- `src/components/instagram/ImportFromSocialLinkDialog.tsx` → `contacts.created_by`
- `src/components/instagram/ProfileSearchEngine.tsx` → `contacts.created_by`
- `src/hooks/useAmbassadors.ts` → `contacts.created_by`
- `src/utils/escavadorPartyUtils.ts` → `contacts.created_by`

## Autoria no Externo: `auth.uid()` de lá não é a pessoa

A sessão que o `externalSupabase` carrega é **anônima** (`auth.users.is_anonymous
= true`, sem e-mail) — o login de verdade acontece no Cloud. Prova: dos 8.724
registros `actor_kind='system'` do `lead_activity_audit_log`, **zero** resolvem
nome, e os uuids que aparecem como `actor_id` são todos de usuários anônimos.

Consequência prática: **nenhum trigger no Externo descobre sozinho quem alterou
a linha.** O `coalesce(NEW.updated_by, auth.uid())` que os triggers usam só
acerta quando o app mandou `updated_by` — o resto vira `system`. Toda escrita
que precise registrar autoria (`updated_by`, `created_by`, `completed_by`) tem
que carimbar o ext_uuid explicitamente; helper único em
`src/lib/currentExtUser.ts` (`currentExtUserId()`).

Isso descarta a solução que parece óbvia — "põe um trigger pra preencher
`updated_by`". Ela grava uuid de sessão descartável e o nome continua não
resolvendo. Ver o efeito na tela em `atividades.md` → Ficha da atividade.

## O que NÃO resolve

**Mover os perfis para o Externo.** O login continua no Cloud (é onde o auth do
Lovable vive), então as duas identidades continuariam existindo e o
`auth_uuid_mapping` continuaria necessário. Seria o custo da migração para ficar
com o mesmo bug.

## O que resolve, do mais barato ao mais caro

1. **Corrigir as 134 linhas** já gravadas erradas (tabela acima).
2. **Parar a sangria**: ao criar membro novo, criar o usuário no Externo com o
   MESMO uuid do Cloud (a API admin do Supabase aceita o id). O mapeamento vira
   identidade para todo mundo novo e o problema encolhe sozinho.
3. **Tornar impossível esquecer**: um helper único de escrita no Externo que já
   traduz, ou um guard de runtime nos moldes do `installDbRoutingGuard` que já
   existe no `main.tsx` para o problema irmão (client errado por tabela).
4. **Unificar o auth de verdade** — migrar `auth.users`, refazer o login de todo
   mundo, mexer na integração do Lovable. Só se continuar sangrando depois de
   1–3.
