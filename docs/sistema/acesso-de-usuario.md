# Liberar acesso de uma pessoa ao sistema

> Levantado em 10/09/2026 lendo o código do fluxo e medindo no Externo
> (`kmedldlepwiityjsdahz`) e no Cloud (`gliigkupoebmlbwyvijp`).
> Motivo: a rotina tem três armadilhas que só aparecem depois que a pessoa já
> está dentro com a inbox errada, sem permissão nenhuma, ou invisível nos
> seletores.

## Onde isso acontece

Tela **Equipe** (`/team` → aba **Membros** → `src/components/team/TeamManagement.tsx`).
Cadastro público está desligado (`PUBLIC_SIGNUP_ENABLED = false`,
`src/components/auth/AuthForm.tsx:15`) — ninguém entra sozinho.

Dois caminhos, no toggle do topo do card, **visível só para admin**
(`TeamManagement.tsx:377`):

| | Criar acesso direto | Convite por e-mail |
|---|---|---|
| quem define a senha | você (senha provisória) | a própria pessoa |
| depende de e-mail chegar | não | sim (ou ela usa "tenho convite" no `/auth`) |
| entra em | `auth.users` do Cloud, na hora | `team_invitations`, expira em 7 dias |
| serve para | urgência, pessoa ao lado, e-mail que não chega | fluxo normal |

Nada disso é executável do terminal: `create-cloud-user` e `bulk-create-users`
passam por `requireAdmin`, a policy de INSERT em `team_invitations` é
`WITH CHECK (is_admin(auth.uid()))`, e **não existe service role do Cloud** no
repo, no `.env` ou no Railway (só `CLOUD_ANON_KEY`). O PAT do `.env.diag` não
alcança o projeto do Cloud (403; o projeto nem aparece em `/v1/projects`).
Reconfirmado 10/09/2026.

## Antes de abrir a tela: copiar de quem já funciona

Perfil e instâncias se decidem olhando alguém do mesmo papel, no Externo com
service role — `profiles.user_id` é o **ext_uuid** (com `profiles.id` as três
tabelas voltam vazias):

```sql
select p.full_name, p.user_id as ext_uuid,
       (select string_agg(m.module_key||':'||m.access_level, ', ')
          from member_module_permissions m where m.user_id = p.user_id) as modulos,
       (select string_agg(wi.instance_name, ', ')
          from whatsapp_instance_users u
          join whatsapp_instances wi on wi.id = u.instance_id
         where u.user_id = p.user_id) as instancias
  from profiles p
 where p.full_name ilike '%nome do modelo%';
```

Medido em 10/09/2026 para os acolhedores do board Trabalhista (Renan Vieira
Mendes, Juliana Clara Santos Pimentel, Bruno Wenner Dantas Nunes): os três têm
os mesmos 5 módulos em `edit` — `activities`, `calls`, `contacts`, `leads`,
`whatsapp` — e **nenhuma instância de WhatsApp vinculada**. É o perfil
**Comercial**; não existe perfil "Acolhedor".

O **nome completo** precisa ser escrito igual ao que aparece em
`leads.acolhedor` e em `src/lib/acolhedorPhotos.ts`: o trigger
`handle_new_user` copia `user_metadata.full_name` para `profiles.full_name`, e
é por esse texto que a pessoa casa com foto, seletor e filtro. Nome vazio →
perfil sem nome.

## Rotina: criar acesso direto

1. `/team` → aba **Membros** → alternar para **"Criar acesso direto"**.
2. **Email** e **Nome completo**.
3. **Perfil de Acesso** — escolher já preenche módulos **e instâncias** do
   perfil (`DirectAccessForm.tsx:45-56`).
4. **Abrir "Ver Acessos"** e conferir. Passo obrigatório, ver armadilha 1.
5. **Senha provisória** — já vem gerada: 14 caracteres, sem `l I 1 O 0`
   (`src/lib/tempPassword.ts:14`). Trocar é permitido; o mínimo é 12 com
   maiúscula, minúscula, número e símbolo (`validateTempPassword`).
6. **Criar acesso** → o `TempPasswordDialog` mostra e-mail e senha.
   **Copiar na hora**: não é exibida de novo e não fica guardada em lugar
   nenhum.
7. Mandar por canal seguro e pedir a troca no primeiro acesso — o sistema
   **não** força a troca, é só o texto do diálogo.

### O que roda por baixo (duas etapas, sem transação)

1. `create-cloud-user` → `auth.admin.createUser` com `email_confirm: true`
   (nasce confirmado, sem link de e-mail). O trigger `handle_new_user` cria o
   `profiles` mínimo no Cloud.
2. `applyAccessProfile(userId, perfil)` (`src/lib/applyAccessProfile.ts`) →
   grava `user_roles` (role + `access_profile_id`), **apaga e recria**
   `member_module_permissions` e chama a edge `admin-whatsapp-instance` com
   `replace_user_instance_accesses`.

Se a etapa 1 passar e a 2 falhar (toast vermelho depois da conta criada), a
conta **existe e loga, mas sem permissão nenhuma**. Conserto: na lista de
membros, trocar o perfil no seletor inline (`handleInlineProfileChange` refaz o
mesmo trabalho).

### Depois: a pessoa só aparece nos seletores quando logar

O espelho no Externo (`profiles` + `auth.users` com o mesmo uuid) nasce no
**primeiro login dela**, quando `useAuth` chama `sync-user-to-external`
(`src/hooks/useAuth.ts:83`) — não na hora em que o admin cria a conta. Antes
disso ela não é atribuível, não recebe atividade e não sai em filtro. Conferir
depois do primeiro login:

```sql
select u.email, p.full_name,
       (select count(*) from member_module_permissions m where m.user_id = p.user_id) as modulos,
       (select count(*) from whatsapp_instance_users w where w.user_id = p.user_id) as instancias
  from auth.users u
  left join profiles p on p.user_id = u.id
 where u.email = 'email@da.pessoa';
```

## Rotina: convite por e-mail

INSERT em `team_invitations` (`inviteMember`, `src/hooks/useTeamMembers.ts:139`)
com `role`, `access_profile_id`, `module_permissions` (jsonb
`[{module_key, access_level}]`) e `whatsapp_instance_ids` (uuid[]) + edge
`send-team-invitation`.

A pessoa entra em `/auth` → "tenho um convite" → a RPC
`check_pending_invitation(p_email)` valida (`accepted_at IS NULL AND
expires_at > now()`, migration `20260724120000`) → ela cria a senha. No INSERT
em `profiles`, o trigger `on_profile_created_consume_invite`
(`consume_team_invitation_on_signup`, migration `20260506192812`) aplica
`user_roles`, `member_module_permissions` e `whatsapp_instance_users` e marca
`accepted_at`.

Para saber se alguém tem convite válido, sem ser admin: POST na RPC
`check_pending_invitation` do Cloud com a anon key — é SECURITY DEFINER com
grant para `anon`. Ler `team_invitations` direto com a anon key devolve `[]`
mesmo sem filtro (RLS): é falso-vazio, não serve de resposta.

## Armadilhas

1. **O perfil pré-preenche as instâncias** (`DirectAccessForm.tsx:54`:
   `setInstances(p?.whatsapp_instance_ids || [])`). Cada `access_profiles`
   carrega uma lista antiga: **Comercial → "Viviane"**, Atendimento →
   "Atendimento Processual", Operacional → "Atendimento Previdenciário" +
   "Atendimento Processual". Criar sem abrir "Ver Acessos" dá para a pessoa a
   inbox de outro. Sempre abrir e conferir.
2. **A lista de instâncias mostra instância morta.** Vem de
   `whatsapp_instances` do Externo filtrando `is_active = true`
   (`TeamManagement.tsx:118`), e esse campo mente: 26 cadastradas, 8 realmente
   conectadas. Marcar uma morta dá inbox vazia sem erro.
3. **E-mail que já existe vira redefinição de senha.** A edge cai no ramo
   `password_reset` e **troca a senha da pessoa**
   (`supabase/functions/create-cloud-user/index.ts:47`). E esse ramo usa
   `listUsers()` **sem paginação**, que traz só 50 usuários: se o e-mail não
   estiver nesses 50, nem redefine — devolve 500 "already been registered".
   Para quem já é membro, o caminho é o botão da chave na linha dele
   ("Definir senha provisória / liberar login", `TeamManagement.tsx:657`).
4. **Rodar o formulário em quem já tem acesso apaga as permissões atuais** —
   `applyAccessProfile` faz `delete` em todos os `member_module_permissions`
   antes de reinserir, e `replace_user_instance_accesses` substitui a lista de
   instâncias inteira.
5. **Lista de instância vazia = sem acesso**, nunca "todas"
   (`src/integrations/supabase/permissions.ts:20`). "Gestão / Liderança" e
   "Administrador" têm a lista vazia no perfil.
6. **Só perfil `is_system` vira `role = 'admin'`** (`applyAccessProfile.ts:18`).
   Escolher "Gestão / Liderança" não dá admin. E o perfil Administrador zera
   módulos e instâncias de propósito (`DirectAccessForm.tsx:88-93`).
7. **O `user_roles` do Externo mente sobre quem é admin** — 13 linhas
   `role=admin`, 11 criadas em lote em 30/03/2026, várias delas `member` no
   Cloud, que é o que o app lê. Para saber o papel real: RPC `is_admin` do
   Cloud com a anon key (`{_user_id: <cloud_uuid>}`). Ver
   [identidade-de-usuario.md](identidade-de-usuario.md).

## Perfis de acesso hoje

Todos `is_active`: Administrador (`is_system`, o único que vira `admin`),
Atendimento, Comercial, Financeiro, Gestão / Liderança, Operacional,
Tráfego / Marketing.

## "A pessoa está bloqueada" — são dois bloqueios diferentes

> Levantado em 14/09/2026 no caso da Gladys Dantas, que via as duas coisas ao
> mesmo tempo. Separar antes de mexer: a correção de um não resolve o outro.

| sintoma | de onde vem | conserto |
|---|---|---|
| toast **"Seu acesso foi desativado. Fale com o administrador."** + logout na abertura | `org_user_status.active = false` no Externo, lido pelo `UserStatusGuard` (`src/components/auth/UserStatusGuard.tsx:20`) | `/team` → **Times** → mostrar inativos → religar o toggle (`TeamsManager.tsx:336`) |
| tela **"Acesso Restrito — Você não tem permissão para acessar esta seção."** | `member_module_permissions` no **Cloud**, lido pelo `ProtectedRoute` (`src/components/ProtectedRoute.tsx:36`) | `/team` → **Acessos** na linha da pessoa |

O login em si nunca é barrado: `active = false` deixa entrar e desloga logo
depois. E o guard lê pelo `externalSupabase` — se a sessão anônima do Externo
não subir, a query volta vazia, o guard não desloga e a pessoa navega normal.
Por isso o bloqueio parece **intermitente**: não é.

**Só um punhado de rotas tem gate.** Nenhuma rota passa `requiredModule`; o
módulo é auto-detectado pelo `pathname` contra `MODULE_DEFINITIONS`
(`useModulePermissions.ts:15`), que cobre 9 caminhos: `/`, `/leads`,
`/analytics`, `/finance`, `/workflow`, `/calls`, `/whatsapp`, `/leaderboard`,
`/team` (esse último sempre liberado, exceção no `canView`). Todo o resto do
menu — Casos, Processos, Notícias, POP, Dashboard — abre para qualquer pessoa
autenticada. **O `AppSidebar` não filtra por permissão**: mostra o menu inteiro
para todo mundo, e o clique é que bate no muro. Quem entra com perfil Comercial
acha que o sistema quebrou ao clicar em Analytics e Finanças.

**Descobrir qual perfil a pessoa recebeu, sem ler o Cloud** (não há service role
do Cloud em lugar nenhum): a instância de WhatsApp vinculada entrega. Vincular
instância é a **última** etapa do `applyAccessProfile`
(`src/lib/applyAccessProfile.ts:47`) — se ela existe, `user_roles` e
`member_module_permissions` já passaram. E cada instância aponta para um perfil:

```sql
select wi.instance_name, u.created_at
  from whatsapp_instance_users u
  join whatsapp_instances wi on wi.id = u.instance_id
 where u.user_id = '<ext_uuid>';
-- "Viviane" → Comercial | "Atendimento Processual" → Atendimento
-- Comercial = activities, calls, contacts, leads, whatsapp (5, todos edit).
-- Sem analytics, finance, instagram, whatsapp_private.
```

O `member_module_permissions` do **Externo** não serve de resposta: é fóssil,
parou em 26/04/2026. O vivo é o do Cloud.

**Criar acesso não desativa ninguém.** A hipótese volta sempre; foi medida em
14/09/2026 e não se sustenta: `org_user_status.active` tem `DEFAULT true`, a
tabela não tem trigger, e a **única** escrita de `active = false` no repo inteiro
(src, edges, migrations, railway-server, scripts) é o `toggleActive` da aba Times
(`TeamsManager.tsx:336`). `create-cloud-user`, `DirectAccessForm`,
`applyAccessProfile` e o trigger `handle_new_user` não tocam nessa tabela. Na
Gladys, a conta nasceu 11/09 12:06:44 e a desativação está carimbada 14/09
12:04:41 — três dias depois.

As 19 desativações de **15/07/2026** são do dia seguinte ao da migration que
criou a tabela (`20260714010000_org_user_status.sql`), em duas rajadas
(14:28:03→14:29:02 e 17:11:29→17:11:57, 2-5 s entre linhas) e incluem `teste`,
`xxx xxxx` e `xxxxx xxxxxxxx`: é faxina manual na lista recém-criada, não efeito
colateral de cadastro. Nela caiu junto gente com trabalho vivo — Crisley
(583 atividades pendentes), Renan, Martin Rafael, Mariana Vitório, Manoel Vitor.

**Ninguém fica registrado.** `org_user_status` guarda `updated_at`, não quem
mexeu, e a policy é `org_user_status_authenticated_all` (ALL / `USING true` /
`WITH CHECK true` TO `authenticated`): qualquer pessoa logada desativa qualquer
outra, sem rastro. Foi assim que a Gladys caiu em 14/09 às 09:04 BRT — o único
vizinho na linha do tempo é outra alteração na mesma tela 8 minutos depois.
