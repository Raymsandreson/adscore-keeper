# Data Stone — enriquecimento cadastral por telefone

Integração para preencher **CPF e dados cadastrais** de leads que chegaram só com
telefone. Serve procuração e requerimento do INSS, que hoje dependem de OCR de
documento. Publicada em 15/09/2026.

## Por que por telefone, e não por CPF

Medido no Externo em 15/09/2026:

| | |
|---|---|
| leads vivos | 24.392 |
| com telefone e **sem** CPF | **12.245** ← a fila |
| com CPF e **sem** telefone | 6 |

O caminho CPF → telefone alcança 6 leads. É por isso que a consulta é
telefone → cadastro, e não o contrário.

## Credencial e limites

- `DATASTONE_TOKEN` no serviço **WhatsJUD** do Railway. O header é
  `Authorization: Token <chave>` — não `Bearer`.
- O `/health` traz `datastone.token` (booleano), para conferir de fora se a
  variável chegou ao serviço.
- **Rate limit: 100 requisições/dia**, compartilhado com o painel, e estourar
  **bloqueia a conta por 24h**. IP na whitelist fica isento; o IP de saída do
  Railway foi aceito sem cadastro, então a whitelist não foi necessária (e o IP
  segue desconhecido — ele só aparece na mensagem do 401).
- Limite de produto B2C: 100.000/mês.

## O que a API devolve de verdade

O spec descreve o schema do `/persons/`. **A busca por telefone devolve outra
coisa** — conferido contra a API real:

```
/persons/search/?phone=<DDD+numero>   →  name, cpf, age, city, district (UF), ddd, number, mother_name
```

Sem `addresses[]`, sem `birthday`, sem `rg`. Três armadilhas:

1. **O parâmetro é o telefone nacional** (DDD+número), sem o `55`.
2. **`cpf` vem como número.** Convertido direto, `012.345.678-90` vira um CPF de
   10 dígitos que não é de ninguém. Passa por `cpfDaResposta`, com `padStart`.
3. **Ficha completa é outra chamada.** Nascimento, nome da mãe, RG e endereço
   exigem `/persons/?cpf=` (+1 crédito). Essa segunda tem carência de 24h por
   documento; a busca por telefone **não tem** — reconsultar cobra de novo.

Consulta sem retorno **não cobra** (medido: saldo antes e depois idênticos).

## As três travas

Em `railway-server/src/functions/datastone-consulta.ts`:

1. **Cache** em `datastone_consultas`, porque a busca por telefone não tem
   carência. Sem ele, reprocessar a fila pagaria tudo de novo.
2. **Teto diário** de `system_settings.datastone_teto_diario` (padrão 80, abaixo
   dos 100/dia). Ao atingir, o lote para. 429, 402 e 401 interrompem o lote
   inteiro — insistir depois de um 429 só prolonga o bloqueio de 24h.
3. **Gate de nome** com `conferirNomeDoSegurado`, o mesmo comparador do vínculo
   de protocolo do INSS. Veredito diferente de `ok` não grava nada.

Só preenche campo **vazio** do lead. Valor diferente do que o CRM já tem não é
sobrescrito: sai em `divergentes`.

## Piloto de 50 leads (15/09/2026)

```
50 alvos → 46 consultados + 4 do cache
41 com dado  ·  9 sem retorno (não cobraram)  ·  37 créditos
19 gravados (CPF, cidade, UF)  ·  22 conflito de nome
```

**O gate evitou 22 gravações erradas em 41.** E o motivo do conflito não é
apelido: em 19 dos 22 o lead tem nome civil completo e a Data Stone devolve
**outra pessoa, muitas vezes de outro sexo**:

```
BRUNO      ← lead JULIANA CESAR OLIVEIRA FERREIRA
UBIRAJARA  ← lead JAQUELINE FERNANDA SANTOS
VALDINEI   ← lead MARIA CLAUDIELE OLIVEIRA
```

A base cadastral associa o telefone ao **titular da linha**, não a quem usa o
WhatsApp. Sem o gate, quase metade dos CPFs gravados seria do marido, do pai ou
do dono anterior do número — e viraria procuração em nome de quem não é o
cliente. O conflito, portanto, não é "conferir e aprovar": na maioria é dado de
outra pessoa, para descartar.

**Custo real:** 37 créditos para 19 leads úteis ≈ **1,95 crédito por lead**.
Extrapolando a fila inteira (12.245): ~12.000 créditos para ~4.600 leads com CPF.

## Como rodar

```bash
# sonda: 0 créditos, confere chave, IP e saldo
curl -X POST $RAILWAY/functions/datastone-apitest -d '{}'

# simulação: diz quem seria consultado, sem tocar na rede
curl -X POST $RAILWAY/functions/datastone-consulta -d '{"simular":true,"limite":50}'

# lote gravando (1 crédito por lead com retorno)
curl -X POST $RAILWAY/functions/datastone-consulta -d '{"limite":50,"gravar":true}'

# ficha completa (+1 crédito, só nos que passam no gate de nome)
curl -X POST $RAILWAY/functions/datastone-consulta -d '{"limite":10,"completo":true}'
```

Sem `lead_ids`, a fila é `deleted_at is null` + `cpf is null` + `lead_phone like '55%'`,
mais recentes primeiro.

## Rollback

- Gravação: só preenche campo vazio, então desfazer é voltar a `null`. O estado
  anterior dos 50 do piloto está em `scratchpad/datastone-piloto-backup-20260915.json`.
- Tabela: `drop table public.datastone_consultas;` — nada depende dela.
- Integração inteira: remover `DATASTONE_TOKEN` do Railway derruba as duas
  funções com `sem_token`, sem afetar mais nada.

## Em aberto

- **7 créditos sem explicação.** O saldo caiu 48 enquanto a tabela registrou 41,
  e consulta sem retorno comprovadamente não cobra. Resta uso da conta pelo
  painel ou cobrança extra em alguma consulta — o extrato do painel resolve.
- **`completo: true` nunca rodou** contra a API real; o shape do `/persons/` pode
  divergir do spec como o da busca divergiu.
- **Ficha completa não foi dimensionada**: dobra o custo por lead.
