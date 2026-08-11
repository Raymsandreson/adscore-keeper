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

## Gravar em `profiles` pelo navegador: não dá (medido em 10/08/2026)

A policy de UPDATE de `public.profiles` no Externo é
`auth.uid() = user_id OR is_admin(auth.uid())`. Parece que o front atende — mas
não atende, e a razão é a seção acima levada às últimas consequências:

- `public.profiles` tem **4.308 linhas para 52 e-mails**. A diferença são
  **4.258 perfis de usuários anônimos**: existe um perfil por sessão anônima
  criada, e hoje 100% dos anônimos têm linha lá.
- Logo `auth.uid() = user_id` **casa** — com o perfil descartável da própria
  sessão anônima, nunca com o perfil da pessoa que está logada no Cloud.
- A outra perna da policy também não salva: `is_admin` é
  `has_role(uid,'admin')` e **nenhum** usuário anônimo tem role admin (0 de 4.258).

Resultado: `db.from('profiles').update(...).eq('user_id', extUserId)` disparado
do front **não afeta linha nenhuma**, e o PostgREST devolve sucesso com 0 linhas
— falha silenciosa, sem erro no console.

Quem grava perfil é sempre um backend com service role:

| o quê | onde | como resolve a pessoa |
|---|---|---|
| foto de perfil | `railway-server/src/functions/update-profile-avatar.ts` | JWT do Cloud → `/auth/v1/user` → `auth_uuid_mapping` → ext_uuid |
| nome / e-mail / telefone | edge `sync-user-to-external` (`action: 'update_profile'`), usada pela tela Equipe | recebe o `user_id` no body |

Na leitura vale o inverso do de sempre: SELECT é liberado para qualquer sessão
autenticada (`Authenticated users can view all profiles`), então ler pelo
ext_uuid funciona direto do front — é o que `src/hooks/useMyAvatar.ts` faz. Ler
o avatar pelo `profile` do `AuthContext` seria pior: aquele objeto vem da edge
`sync-user-to-external`, que busca a linha pelo uuid do **Cloud**.

> **Pendência conhecida:** o seletor "Instância de WhatsApp padrão" da tela Meu
> Perfil (`src/pages/ProfilePage.tsx`) grava direto pelo front e cai exatamente
> nessa armadilha — o `toast` diz "Perfil atualizado" e o banco não muda.
> `default_instance_id` está preenchido em 8 dos 52 perfis, todos com origem
> anterior a essa tela.

### As três fontes de foto de pessoa (ago/2026)

O avatar do menu do usuário lê `profiles.avatar_url` pelo ext_uuid, mas os
avatares espalhados pelo app resolvem a pessoa **pelo nome** — o responsável da
atividade guarda `assigned_to_name`, o card do lead guarda `leads.acolhedor`.
Até 11/08/2026 esse caminho por nome só olhava a tabela `acolhedores` (6 linhas,
nenhuma com `foto_url`) e os assets locais de `src/lib/acolhedorPhotos.ts`, então
quem trocava a foto em Meu Perfil aparecia com foto no topo e com iniciais na
atividade.

Hoje `buildPersonAvatar` (`src/hooks/useAcolhedores.ts`) tenta nesta ordem:

1. `profiles.avatar_url` casando `full_name` normalizado — via
   `src/hooks/useProfileAvatars.ts`, que carrega só quem tem foto
   (`avatar_url not null`, hoje 1 de 4.328 linhas);
2. `acolhedores.foto_url` (curadoria manual, ainda vazia);
3. asset local de `acolhedorPhotos.ts` (6 pessoas, legado);
4. iniciais com cor determinística por hash do nome.

Consequências práticas: quem não tem linha em `acolhedores` passa a ter foto
mesmo assim, e trocar a foto em Meu Perfil chama `setProfileAvatarInCache` para
o avatar mudar nas outras telas sem esperar o TTL de 30s do `sharedFetch`. O
casamento é por nome exato normalizado — se `assigned_to_name` divergir do
`full_name` do perfil (apelido, nome antigo), volta para as iniciais.

## Tirar o acesso de alguém (checklist, ago/2026)

A remoção também é meio no Cloud, meio no Externo. Nesta ordem:

1. **Bloquear o acesso** — `org_user_status` no Externo, `active = false`
   (chaveado pelo **uuid do Cloud**). O `UserStatusGuard` (`App.tsx`, montado em
   todo app logado) lê essa coluna na abertura, mostra o toast e força
   `signOut()`. É o bloqueio real; o toggle da tela é
   `TeamsManager.toggleActive`. Pessoa sem linha na tabela **não está bloqueada**
   — o `maybeSingle()` volta `null` e o guard não faz nada.
2. **Redistribuir as pendentes** — `lead_activities.assigned_to` + o snapshot
   `assigned_to_name` (e `assigned_to_ids`/`assigned_to_names` se houver
   co-assessoria). Cuidado com o namespace: para quem tem uuid diferente nos
   dois lados, o `assigned_to` costuma ser o **id do Externo**. Confira contando
   os dois antes de escolher o destino. A tela tem o
   `RedistributeActivitiesDialog`, que só enxerga quem já está inativo.
3. **Cortar as integrações** — `whatsapp_instance_users` (Externo é o canônico;
   a edge `get-my-instance-accesses` lê de lá, e o espelho do Cloud só entra
   como fallback), `profiles.default_instance_id`, `push_subscriptions`,
   `user_roles` do Externo (nenhuma policy do Externo referencia essa tabela).
4. **Fechar o relógio** — `work_shifts.ended_at` e `activity_time_entries` em
   `running`. Sem isso a pessoa fica "trabalhando" para sempre no painel de
   timers e na produtividade.
5. **Sumir dos seletores** — `ASSIGNEE_BLOCKLIST` (`src/lib/assigneeBlocklist.ts`).
   O `profiles` continua existindo de propósito, para o histórico não degradar
   para uuid cru.
6. **Sumir da listagem de usuários** — a lista da tela Equipe é `user_roles` +
   `profiles` do **Cloud** (`useTeamMembers.ts`), fora do alcance do MCP. Quem
   apaga é o botão "Remover membro" da própria tela.
7. **Matar o login** — só pelo dashboard do Cloud (deletar/banir em `auth.users`).
   Enquanto existir, a pessoa autentica e o guard do passo 1 derruba em seguida.
8. **Fechar a credencial do espelho** — o Externo tem um `auth.users` **próprio**,
   e a linha nasce com e-mail confirmado e **senha utilizável**. Apagar a conta no
   Cloud não encosta nela. O app nunca usa essa porta (a sessão do Externo é
   `signInAnonymously`, `external-client.ts:31`), mas o endpoint de auth é público
   e a anon key está no bundle: e-mail + senha ali devolve um JWT `authenticated`
   de verdade no projeto que guarda os dados de cliente. Feche com
   `update auth.users set banned_until = '2099-12-31'` — **não** apague a linha,
   porque `profiles.user_id → auth.users` é CASCADE e leva o perfil junto.
   Em 11/08/2026 eram 23 contas de gente já desativada com senha viva: 22 foram
   fechadas com ban nesse dia (rollback em
   `scratchpad/rollback-ban-contas-inativas-20260811.sql`) e ficou de fora, a
   pedido, só a conta real da Maria Clara Nunes (`claramilanex@`, 16 pendentes).
   Para achá-las, junte `org_user_status` (chaveada pelo uuid do **Cloud**) com
   `auth.users` do Externo (uuid do **Externo**) **passando pelo
   `auth_uuid_mapping`** — o join direto perde 8 das 22.

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
