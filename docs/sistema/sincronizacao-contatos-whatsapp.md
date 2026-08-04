# Sincronização de contatos com o WhatsApp (UazAPI `/chat/details`)

Como o WhatsJUD mantém nome, foto, CPF/RG, endereço, etiquetas e grupos em comum
de um contato alinhados com o que o WhatsApp conhece.

## O endpoint

`POST /chat/details` da UazAPI (uazapiGO V2). Devolve o modelo Chat completo de
um contato ou grupo — mais de 60 campos, combinando três fontes: o que o
WhatsApp sabe, o que está salvo na agenda do chip e o que o CRM da UazAPI
guarda como lead.

```
POST {base_url}/chat/details
Headers: { "Content-Type": "application/json", "token": "<instance_token>" }
Body:    { "number": "5511999999999", "preview": false }
```

- `number` — telefone ou JID de grupo. Obrigatório.
- `preview` — `true` devolve a foto em tamanho reduzido (listagens), `false`
  devolve a resolução original. Default `false`.

Erros: `400` payload/número inválido · `401` token ausente · `500` erro interno
ou sessão não iniciada.

**É um endpoint de leitura.** Ele atualiza o banco da própria UazAPI quando
encontra dado desatualizado, mas **não escreve na agenda do celular**. Gravar o
nome de volta no aparelho exigiria um endpoint de escrita, que não está
implementado.

## Onde mora a implementação

| Arquivo | Papel |
|---|---|
| `railway-server/src/lib/uazapi-chat-details.ts` | **Única** implementação: fetch, normalização, cache, aplicação em `contacts` |
| `railway-server/src/functions/sync-chat-details.ts` | Handler HTTP, modos `single` / `batch` / `stale` |
| `whatsapp_chat_details_cache` (Externo) | Cache do modelo Chat, PK `(instance_name, phone)` |

Consumidores: `get-group-participants` (modal de membros), `verify-agent-label`
(etiqueta do agente antes de responder) e `whatsapp-webhook` (refresh
automático). Todos usam a lib — não refaça o parse.

## Como o dado se mantém atualizado

Não existe varredura completa da base. Com ~31 mil contatos, sincronizar todos
de uma vez seriam 31 mil chamadas à UazAPI. O modelo é **quem conversa é quem é
renovado**:

1. Chega mensagem de entrada no `whatsapp-webhook`.
2. Um throttle em memória (24h por telefone) decide se vale checar.
3. Se o cache está vencido, dispara `getChatDetails` em background — a mensagem
   já foi salva, então nada disso pode atrasar ou derrubar o webhook.
4. O resultado vai para o cache e é aplicado em `contacts`.

O modo `stale` do handler cobre a cauda: renova em lote quem está velho no cache
e não conversa há tempos.

## Regra de escrita em `contacts`

**Só preenche campo vazio.** O que a equipe digitou no WhatsJUD vence o que veio
da API. Duas exceções deliberadas:

- **Nome placeholder** (`"Participante 1234"`) é substituído — existe só para a
  linha não ficar sem rótulo.
- **Foto** se atualiza sozinha: o WhatsApp é a fonte da verdade dela e a URL da
  UazAPI expira. Um avatar enviado manualmente (host que não é da UazAPI) não é
  sobrescrito.

Mapeamento dos campos livres do CRM da UazAPI, herdado do
`import-group-participants`:

| Campo | Significado |
|---|---|
| `lead_field12` | CPF (alternativo a `lead_personalid`) |
| `lead_field13` | RG |
| `lead_field14` | Endereço (rua + número) |
| `lead_field15` | Bairro |
| `lead_field16` | CEP |

## Chamando o handler

```jsonc
// um contato — o que a ficha de contato usa
{ "mode": "single", "phone": "5511999999999", "instance_name": "abraci01", "refresh": true }

// lista — o que o modal de membros de grupo usa
{ "mode": "batch", "phones": ["5511...", "5521..."], "instance_name": "abraci01" }

// varredura do que está velho — modo do cron
{ "mode": "stale", "limit": 100, "max_age_hours": 24 }
```

`apply_to_contact` (default `true`) controla se o resultado é gravado em
`contacts`. Teto de 500 telefones por chamada.

## Armadilhas já pagas

- **O campo é `wa_common_groups`, não `common_groups`** — e vem como **string**,
  não array: `"Nome do grupo(1203...@g.us), Outro(1203...@g.us)"`. O nome pode
  conter vírgula e `|`, então o separador confiável é o par de parênteses com o
  JID dentro. Ler o nome errado devolvia `[]` em todo participante, silenciosamente.
- **Coluna que não existe derruba o upsert inteiro.** O código gravava
  `lead_field12..16` numa tabela sem essas colunas; o PostgREST rejeita a linha
  toda (PGRST204) e o cache parou de ser escrito por meses sem ninguém notar —
  o sintoma era só "o modal está lento" (refazia todas as chamadas à UazAPI a
  cada abertura). Ao adicionar campo ao cache, migration primeiro.
- **`false` é resposta válida.** Ler booleano com `a || b || null` transforma
  `wa_archived: false` em `null`. A lib usa um leitor separado para booleanos.
- **Nem toda instância enxerga o número.** Só a instância com o chat aberto
  responde; a busca tenta a preferida e cai para as demais.
- **Timestamps vêm em ISO ou epoch (s ou ms).** Epoch em segundos tratado como
  ms cai em 1970 e o registro parece sempre vencido.
- **Telefone não vai para log.** É dado pessoal (LGPD) — o log registra o motivo
  da falha, não o número.

## Custo

Uma chamada UazAPI por contato por 24h, só para quem trocou mensagem. O modo
`stale` tem teto por rodada (default 100, máximo 500) porque cada telefone é uma
chamada. Número que falha 5 vezes seguidas sai da fila de retentativa
(`sync_attempts`), senão ocupa vaga de quem ainda dá para resolver.
