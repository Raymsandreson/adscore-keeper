# Acesso às linhas da WhatsApp API (Meta)

> Levantado e implementado em 15/09/2026, medindo o Externo
> (`kmedldlepwiityjsdahz`) e lendo o caminho da caixa de entrada.
> Motivo: a matriz de acesso listava as linhas da API junto das sessões UazAPI,
> sem dizer que eram outro canal — e o que se marcava nelas **não valia** no
> menu WhatsApp API.

## O que é "linha da API" aqui

`whatsapp_instances` guarda os dois canais na mesma tabela. O que separa é o
token, não o nome:

| | UazAPI (celular pareado) | WhatsApp API (Meta oficial) |
|---|---|---|
| marcador | `instance_token` = token real da UazAPI | `instance_token = 'cloud_api_meta'` |
| quantas (15/09/2026) | 25 | 3 — `abraci`, `prudencio_advogados`, `quitepay` |
| quem reconhece no front | — | `ehInstanciaCloud()` / `TOKEN_CLOUD_API` (`src/lib/cloudApiInstances.ts`) |

Nome cru é o que existe: a tabela não tem coluna de rótulo. `rotuloDaLinha()`
troca `prudencio_advogados` por "Prudencio Advogados" só na exibição.

## O padrão: todo mundo enxerga a Abraci, e só ela

Decisão do usuário em 15/09/2026. Abraci concentra o movimento; Prudencio
Advogados e Quitepay são marcação um a um, na matriz.

Onde a regra mora — um lugar só, `src/lib/cloudApiInstances.ts`:

- `LINHA_CLOUD_PADRAO = 'abraci'`
- `comAcessoCloudPadrao(ids, instancias)` — escolha que não tem **nenhuma**
  linha da API recebe a Abraci; escolha que já tem alguma passa intacta.

Quem chama, e por quê os dois:

| caminho | arquivo |
|---|---|
| acesso criado direto (senha provisória) | `src/lib/applyAccessProfile.ts` |
| perfil trocado na ficha do membro | `src/components/team/MemberDetailSheet.tsx` |

O formulário de criação (`DirectAccessForm.tsx`) e o de perfis
(`AccessProfilesManager.tsx`) já mostram a Abraci **marcada**: deixar
desmarcada na tela e conceder no salvamento fazia a tela mentir sobre o acesso
que estava sendo criado.

## Onde se associa

Tela **Equipe** → aba **WhatsApp** (`src/components/team/WhatsAppInstancePermissions.tsx`).
A matriz separa as colunas em duas faixas — **WhatsApp API (Meta)** primeiro,
**Instâncias UazAPI (celular)** depois — e cada quadradinho continua sendo
clique para conceder/revogar.

Botão **"Padrão da API: só {linha}"**: para os membros filtrados (admins ficam
de fora — enxergam todas as linhas pelo papel), concede a Abraci e revoga as
outras linhas da API. É idempotente de propósito: a concessão vai para todo
membro, mesmo quem já tem o vínculo, porque o edge
`admin-whatsapp-instance / set_instance_accesses` faz upsert **nos dois bancos**
(Externo + espelho do Cloud). Reaplicar é como o espelho se acerta depois de uma
escrita feita fora do app.

Ele também limpa `profiles.default_instance_id` quando o default aponta para uma
linha da API recém-revogada: `get-my-instance-accesses` **soma o default** à
lista de permitidas, então a linha voltaria pela porta dos fundos.

## O buraco que existia até 15/09/2026

`useWhatsAppMessages.fetchInstances`, no ramo da caixa travada no canal Cloud
(o menu WhatsApp API, `lockInstanceName="abraci"`), filtrava só por
`instance_token = 'cloud_api_meta'` — **sem cruzar com os acessos do usuário**.
Resultado: qualquer pessoa logada abria Abraci, Prudencio Advogados e Quitepay
em `/whatsapp-api`, tivesse vínculo ou não. O que a matriz dizia sobre essas
linhas não valia nada ali.

Hoje o ramo cruza com `getMyAllowedInstanceIds`, e sem nenhuma linha liberada a
caixa mostra aviso próprio ("Sem acesso a nenhuma linha da WhatsApp API — peça
em Equipe › WhatsApp") em vez de montar vazia. Na aba Cloud da caixa normal
(sem trava) o acesso já era respeitado.

## Como conferir no banco

```sql
-- quem tem qual linha da API
select p.full_name, i.instance_name
  from whatsapp_instance_users u
  join whatsapp_instances i on i.id = u.instance_id
  left join profiles p on p.user_id = u.user_id
 where i.instance_token = 'cloud_api_meta'
 order by i.instance_name, p.full_name;

-- default apontando para linha da API (acesso que não aparece na matriz)
select p.full_name, i.instance_name
  from profiles p join whatsapp_instances i on i.id = p.default_instance_id
 where i.instance_token = 'cloud_api_meta';
```

Estado em 15/09/2026, antes de aplicar o padrão: 57 usuários com alguma
instância, **55 sem a Abraci**; nenhum `default_instance_id` apontava para linha
da API.

## Pegadinhas

1. **A leitura autoritativa é o Externo** (`get-my-instance-accesses`), mas três
   fluxos ainda leem o espelho do Cloud: `useCallRecords`,
   `useIncomingCallDetector` e `WhatsAppConversationShareDialog`. Escrita feita
   por SQL direto no Externo **não** chega neles — por isso o botão do padrão
   passa pelo edge.
2. **`is_active` mente sobre instância** (26 cadastradas, 8 conectadas na última
   medição). Vale para as colunas da matriz: linha listada não é linha viva.
3. **Convite por e-mail não chega ao Externo.** O aceite é o trigger
   `consume_team_invitation_on_signup` (migration `20260506192812`), que roda no
   Cloud e insere em `whatsapp_instance_users` **do Cloud**. A leitura
   autoritativa é o Externo, então quem entra por convite abre `/whatsapp-api`
   no aviso de "sem acesso" até alguém aplicar o perfil pela ficha do membro
   (passa pelo edge, grava nos dois) ou clicar no botão do padrão. O convite já
   sai com a Abraci marcada — o que falta é o trigger escrever nos dois bancos.
4. **Admin não depende de vínculo**: `fetchInstances` devolve todas as
   instâncias ativas para quem é admin no Cloud. Revogar linha de um admin na
   matriz não muda o que ele vê.
