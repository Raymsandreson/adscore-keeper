# Offboardings — onde mora o rollback de cada um

Toda remoção de pessoa do sistema apaga linha em produção. O rollback dessa
remoção é a única saída de emergência que existe, e por isso **não pode morar no
scratchpad da sessão**: aquele caminho é `/tmp`, que é tmpfs e some no reboot.
Foi o que aconteceu com o caso Edilan em 14/09/2026 — aplicado 18:36, rollback
apagado no reboot do mesmo dia. Rollback de escrita em produção vem para cá,
`scratchpad/` do repo, que é versionado.

Estado conferido contra o Supabase Externo em **14/09/2026**.

| Data | Pessoa | Rollback | Estado hoje |
|---|---|---|---|
| 06/08 | KEILANE DE LIMA TEIXEIRA `f0a5dad8` | **PERDIDO** (ver abaixo) | active=false, ban 2099-12-31, 0 roles, 0 instâncias |
| 11/08 | Maria Clara Mendes `a4eab7b5` | `rollback-maria-clara-mendes-20260811.sql` | active=false, ban 2099-12-31, 0 roles, 0 instâncias |
| 11/08 | Ban de 21 contas inativas | `rollback-ban-contas-inativas-20260811.sql` | 21 de 21 seguem banidas |
| 13/08 | Thaíres Luana Leal Mendes `3dbad7c4` | `rollback-thaires-20260813.sql` + `thaires-backup-20260813.json` (e `remover-thaires-20260813.sql`, o que foi aplicado) | active=false, ban 2126-07-20, 0 roles, 0 instâncias |
| 14/09 | Edilan da Silva Santos `4ede440c` / cloud `c989aa6b` | `rollback-edilan-20260914.sql` + `edilan-backup-20260914.json` | active=false, ban 2126-08-21, 0 roles, 0 instâncias |

Adjacente, mesma classe de risco (rollback de remoção de acesso, não de pessoa):
`rollback-permissoes-conta-20260824.sql` — as 7 linhas de
`user_account_permissions` tiradas ao restringir a aba Conta em 24/08.

**Nenhum destes arquivos rodou.** São saída de emergência: rodar devolve o
acesso da pessoa. Só com pedido explícito do gestor.

## O que se perdeu: o rollback da Keilane (06/08/2026)

`rollback-keilane-20260806.sql`, que a memória `keilane-de-lima-removida` cita,
**não existe** — nem no repo, nem em lugar nenhum da máquina. O transcript da
sessão que fez a remoção (`68dab57a-9c35-40c3-b190-65b76687c0a9`) também não
existe: os transcripts guardados começam em 17/08/2026. Não há de onde
reconstruir, e não vou inventar as linhas.

O que ainda é **fato conferido no banco**, e não palpite:

- A linha em `org_user_status` dela **não foi tocada em 06/08**: o `updated_at`
  é `2026-07-15 17:11:52`, do lote de 15/07. Bate com a memória, que diz que ela
  já estava `active=false` desde julho e mesmo assim seguia recebendo trabalho.
- O **ban está coberto**: ela é uma das 21 contas de
  `rollback-ban-contas-inativas-20260811.sql`, que desbane com
  `banned_until = null`.
- Hoje ela está com 0 `user_roles`, 0 `whatsapp_instance_users`,
  0 `push_subscriptions`, 0 `team_members`, 0 `team_conversation_members`,
  e `profiles` preservado.

O que **não dá para saber** e portanto não tem rollback: quais dessas linhas
existiam antes de 06/08 e com que `id`/`created_at` — inclusive se ela chegou a
ter `user_roles` ou instância. A memória lista as tabelas que o procedimento
*exige* mexer (`whatsapp_cloud_routing_rules.eligible_user_ids`,
`whatsapp_cloud_assignees`, `whatsapp_instance_users`, `user_roles`,
`team_conversation_members`), mas não registra o que foi de fato aplicado nela.

Reverter a Keilane hoje significa **recriar o acesso do zero pela tela Equipe**,
não restaurar estado anterior.

## Duas coisas que a conferência de hoje achou

1. **A Thaíres voltou para o time — e ninguém a recolocou.** O offboarding
   dela em 13/08 apagou `team_members` **só no Externo**. Essa tabela no Externo
   é espelho: a aba Times (Configurações) lê `teams`/`team_members` do **Cloud**
   e, no `useEffect` de montagem (`TeamsManager.tsx:490`, `fetchTeams`), chama a
   RPC `sync_teams_snapshot`, cujo corpo faz **`delete from team_members;`** e
   reinsere o snapshot inteiro do Cloud. Em 14/09/2026 18:56:21 alguém abriu a
   aba: as **25 linhas de `team_members`, dos 8 times, têm esse mesmo
   `created_at` ao microssegundo**, e a linha dela é id novo (`5f72abdc`; o
   antigo `ca1e1629` morreu na época). Ela voltou porque **no Cloud nunca foi
   removida**.

   Consequência para qualquer offboarding: limpar `team_members` no Externo não
   adianta — é desfeito na próxima abertura da aba Times. Quem manda é o Cloud,
   e o Cloud só é alcançável por dashboard/Lovable (o PAT daqui recebe 403).
   Hoje ela é a **única** pessoa desativada presente em `team_members`. Não mexi.
2. **Maria Clara Mendes segue em 1 conversa interna.**
   `team_conversation_members` `1f80fb92`, conversa `18b854a3`, criada em
   10/08 — antes da remoção de 11/08. O rollback dela não cita essa tabela
   porque a remoção nunca a cobriu: é buraco de escopo daquele offboarding,
   não regressão.

## Procedimento

Como remover alguém está na memória `offboarding-usuario-checklist`
(varredura com `scratchpad/scan-uuid.mjs <uuid>`, `org_user_status` é INSERT e
não UPDATE, o que preservar) e o ban do auth do Externo em
`scratchpad/authban.mjs <uuid> 876000h` — `none` desbane.
