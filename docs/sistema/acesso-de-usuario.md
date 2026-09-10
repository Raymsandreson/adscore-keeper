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
