# Jurimetria e fluxo da carteira — estado real em 07/08/2026

Documento de partida para a tela de "quanto dinheiro tem em cada estágio, por carteira e por POP".
**Nada disso está implementado no app hoje.** Este é o mapa do terreno, levantado com SQL no banco real e com a planilha aberta.

Vocabulário de estágios: skill `whatsjud-fluxo-vocabulario` (v4) — é a fonte da verdade e não se reabre aqui.

---

## 1. Onde vivem os dados

Tudo no **Supabase Externo** `kmedldlepwiityjsdahz`. **Nenhuma referência a `jm_` existe no front** — a camada é 100% banco.

**15 tabelas** (07/08/2026):

| Tabela | Linhas | O que é |
|---|---|---|
| `jm_processos` | 344 (333 CNJ distintos) | o processo; tem `caso`, `fase`, `objetivo`, `passo`, `origem` |
| `jm_partes` | 1.201 | **o cliente dentro do processo** — a granularidade que vale |
| `jm_valores` | 1.652 | `dano_moral`, `dano_estetico`, `base_calculo`, `meses_pensionamento`, `hs_pct` |
| `jm_pagamentos` | 1.022 | parcelas: `n_parcela`, `data_prevista`, `data_recebida`, `status`, `desagio` |
| `jm_movimentos` | 37.649 | movimentações (DataJud) |
| `jm_lancamentos` | 4.364 | caixa realizado, com `responsavel` e `categoria`; desde 16/08/2026 tem `parte_id`/`parte_conciliacao` (§10.1) |
| `jm_decisoes` | 439 | decisões, com `termo_inicial_jcm` (base da correção) |
| `jm_marco_config` | 22 | **a régua de marcos da jurimetria** (ver §4) |
| `jm_acordos` | 6 | acordos com `n_parcelas`, `multa_pct` |
| `jm_indices` | — | índices de correção; alimentado pelo cron `jm_indices_diario` |
| `jm_config` | 1 | ver alerta em §7 |
| `jm_documentos`, `jm_datajud_req`, `jm_esc_solicitacoes`, `jm_http_req` | — | apoio/ingestão |

**14 views**, das quais importam: `vw_jm_visao_processo` (1.186 linhas, granularidade cliente — a mais completa), `vw_jm_marcos`, `vw_jm_caixa_classificado`, `vw_jm_fluxo_mensal`, `vw_jm_status_pagamento`, `vw_jm_conciliacao`.

---

## 2. A planilha NÃO está sincronizada

**"Jurimetria/indenização"** — `1WQCQdYwvBBvIfS2iiU1iiFiCZ38j2zHDTmpy1AXxFMM`, dona `raymsandresonadv@gmail.com`, criada em 09/2024.

- **Modificada em 06/08/2026 18:20**
- `jm_processos.created_at` vai de **08/07 a 10/07/2026 e para ali**
- Dos 24 crons do banco, o único `jm_` é `jm_indices_diario` (índices de correção). **Não existe rotina que leia essa planilha.**
- `sync-hearings-from-sheet-daily` é outra planilha (audiências), não esta

**Foi uma carga única de julho.** Um mês de edições não está no banco.

### Aba `Tab. Aux` — o mapa das colunas

Intervalo real **`A3:AB28572`**. Cabeçalho na linha 3:

| Col | Cabeçalho |
|---|---|
| J | Fase Atual |
| K | TOTAL DA CONDENAÇÃO CJCM |
| L | TOTAL PARTE CJCM |
| M | TOTAL À VISTA PARTE CJCM |
| **N** | **HONORÁRIOS CONTRATUAIS À VISTA** |
| **O** | **HONORÁRIOS CONTRATUAIS PARCELADO** |
| **P** | **HONORÁRIOS SUCUMBENCIAIS** |
| Q | AUX |
| R | TEMPO DA ÚLTIMA DECISÃO |

**A separação à vista × parcelado já existe na planilha, em coluna própria (N e O).**

Regra de cálculo, conforme o Raym (07/08/2026): os honorários saem da indenização do cliente — **danos morais + danos materiais (parcelas vencidas e vincendas) + percentual de sucumbência**. Não é percentual fixo.

> **Cuidado ao ler a planilha por ferramenta.** O `read_file_content` do Drive devolve um texto achatado, sem separar abas, e **não traz a `Tab. Aux` inteira** — traz um recorte pequeno de outra aba. Quem confiar nesse export vai subestimar grosseiramente o volume de dados (ver §6, erro 2). Para trabalhar a sério com a planilha, exportar aba por aba.

---

## 3. Os componentes do valor — e o que NÃO concilia

Somando `vw_jm_visao_processo` (1.186 clientes, 342 processos):

| Componente | Valor | Observação |
|---|---|---|
| Dano moral atualizado | R$ 40,23 M | |
| Dano estético atualizado | R$ 1,45 M | |
| **Pensionamento** (`base_calculo_atualizada` × meses) | **R$ 72,07 M** | só 174 clientes têm |
| **Total** | **R$ 113,75 M** | |
| Pago (dedup por processo) | R$ 23,33 M | |
| A receber (dedup por processo) | R$ 0,73 M | |

**`base_calculo` = R$ 6,52 M é a base MENSAL do pensionamento** — o valor de uma parcela, não o total. Multiplicado pelos meses de cada cliente vira os R$ 72,07 M. Confundir os dois é o erro mais fácil de cometer aqui.

**A conciliação com a âncora de ~R$ 41,7 M do vocabulário NÃO fechou.** Moral + estético dá R$ 41,68 M e *parece* bater, mas só porque ignora o pensionamento inteiro. É coincidência, não conciliação (ver §6, erro 1).

### A armadilha do `pago_processo`

`vw_jm_visao_processo` é por **cliente**, mas as colunas `pago_processo` e `a_receber_processo` vêm de `vw_jm_status_pagamento`, que é por **processo**:

```sql
FROM jm_partes pa
  JOIN jm_processos p USING (processo_cnj)
  LEFT JOIN vw_jm_status_pagamento sp USING (processo_cnj)   -- <- por PROCESSO
```

Um processo com 5 clientes repete o mesmo `pago` 5 vezes. **Somar direto dá R$ 112,85 M — falso.** O correto é `select distinct processo_cnj, pago_processo` antes de somar, o que dá R$ 23,33 M. Não é dado sujo; é semântica de coluna. Vale para qualquer coluna com sufixo `_processo`.

---

## 4. Três réguas diferentes — não confundir

| Régua | Onde vive | Itens | Para que serve |
|---|---|---|---|
| **Marcos processuais** | `process_movements` (app) | 12 estações: petição inicial → pagamento | onde o processo está, no app |
| **Marcos da jurimetria** | `jm_marco_config` | 19 marcos em 7 fases: CONHECIMENTO, RECURSAL, ACORDO, SATISFACAO, SUSPENSO, DEFINITIVO, ENCERRADO | onde o processo está, na jurimetria |
| **Estágio de fluxo** | não existe ainda | 7: PROJETADO, CONDENAÇÃO, A RECEBER, VENCIDO, EM EXECUÇÃO, DEPOSITADO EM JUÍZO, PAGO | **cadê o dinheiro** |

As duas primeiras são de base diferente (Escavador vs DataJud) e não se falam. A jurimetria tem estados que o app não tem (`SUSPENSAO_IRDR`, `LIQUIDACAO_INICIADA`).

**Decisão do Raym (07/08/2026): a tela agrupa dinheiro pela régua de 7 estágios de fluxo.** Marco processual é *onde o processo está*; estágio é *quanto daquilo é caixa*. Um acórdão pode ser CONDENAÇÃO (valor certo, sem data) — firme, mas não antecipável. Agrupar dinheiro por marco soma CONDENAÇÃO com A RECEBER e produz número que parece caixa e não é.

---

## 5. Cobertura dos filtros pedidos

Casamento `jm_processos.processo_cnj` × `lead_processes.process_number` (só dígitos):

| | Processos |
|---|---|
| CNJ distintos na jurimetria | 333 |
| Casam com processo vivo do app | **205** |
| Só na jurimetria (fora do app) | 136 |
| Dos casados: com POP (`workflow_name`) | 196 |
| Dos casados: com time (`vw_process_assignment`) | 193 |
| Dos casados: **com dono** (`vw_process_assignment.user_id`) | **140** |

- **Filtro por carteira cobre ~42% da jurimetria.** O resto precisa de um balde "sem carteira" explícito na tela.
- `lead_processes.responsible_user_id` só tem **10** dos 205 — **não usar**. A fonte de dono é `vw_process_assignment` / `process_owners()`.
- **À vista × parcelado**: `jm_pagamentos` cobre **44 dos 333** processos (713 parcelas RECEBIDA, 219 PREVISTA, 90 A REVISAR). Nos outros 289 a modalidade fica **em branco, nunca zero** — zero diria "à vista", e não é o que se sabe.

### Percentuais de honorário já no banco

- `jm_valores.hs_pct`: preenchido em **1.651 de 1.652** — 0% (485), 10% (569), 15% (351), 5% (174), 6% (25), 12% (14)
- `lead_processes.fee_percentage`: 294 de 1.776, média **29,98%**

Servem de referência, **mas não substituem o cálculo da planilha** (§2): o honorário é derivado da indenização, incluindo materiais, não de um percentual chapado sobre o bruto.

### Outros números úteis

184 clientes menores de idade (crédito inalienável, art. 1.691 CC → DEPOSITADO EM JUÍZO) · 0 cotas marcadas como `vendida` · `jm_processos.origem` = INTERNO em 100%.

---

## 6. Dois erros já cometidos aqui — não repetir

**1. "A conciliação fechou" (falso).** Somar moral + estético dá R$ 41,68 M, que bate com a âncora de ~R$ 41,7 M do vocabulário — mas ignora R$ 72,07 M de pensionamento. Bater com um número de memória **não é conciliar**. Conciliação é fechar componente a componente contra a fonte, não achar um total parecido.

**2. "Só 8 clientes têm honorário na planilha" (falso).** Veio de ler o export achatado do Drive, que trouxe um recorte de outra aba. A `Tab. Aux` real vai até a linha 28572. **Nunca concluir sobre volume de dados a partir desse export.**

Os dois têm a mesma raiz: conclusão sobre a base inteira a partir de uma amostra não verificada. Daí o método do §8.

---

## 7. Alertas de segurança

- **`jm_config` guarda a API key do DataJud em texto plano** (`chave = 'datajud_api_key'`). A tabela está com RLS ligado e **zero policies**, então nem `anon` nem `authenticated` leem — só `service_role`. Não é vazamento, mas o lugar de credencial é env var/vault. Corrigir em passada separada.
- **`jm_partes` tem dado pessoal** — `nascimento`, `telefone`, `cep`, `cidade_mora`, `bairro`. RLS ligado, policy `TO authenticated`, SELECT. Qualquer view nova sobre ela precisa de `security_invoker = on`, senão fura o RLS.
- Ao exportar a planilha para arquivo temporário, ela carrega **nome de cliente e CNJ**. Manter no scratchpad da sessão, **nunca no repo**.

---

## 8. Combinado para a próxima sessão: piloto de 5 processos

**Decisão do Raym (07/08/2026): fazer do zero, com 5 processos, e só depois generalizar.**

Método:

1. Escolher 5 processos — de preferência com litisconsórcio (vários clientes) e pelo menos um com parcelas em `jm_pagamentos`, um com cliente menor e um em execução.
2. Para cada par `(processo × cliente)`, fechar **célula a célula contra a `Tab. Aux`**: total da condenação (K), total da parte (L), à vista (M), contratual à vista (N), contratual parcelado (O), sucumbencial (P).
3. Só quando os 5 fecharem, escrever a regra de derivação — e só então rodar na base toda.
4. Conciliar de novo na base toda **antes** de qualquer tela.

Regra dura do Modo Leopardo (do vocabulário): nenhuma migração física sem aval explícito do Raym, sem a conciliação fechar, e fora do horário do cron `esc_colher`. Migrações são aditivas.

O que a tela precisa entregar, quando chegar a hora: filtro **carteira / todas** e **POP**; dinheiro agrupado pelos **7 estágios**; **cota do cliente e honorário em colunas separadas, nunca somadas**; honorário aberto em **à vista × parcelado**.

---

## 9. Perguntas em aberto

1. Os 136 processos que só existem na jurimetria entram na tela ou ficam fora?
2. Reimportar a planilha: quais abas ainda valem, agora que se sabe que a `Tab. Aux` é a que interessa?
3. Sync recorrente da planilha, ou a planilha deixa de ser fonte e o banco passa a ser?
4. Qual régua de marcos morre — ou as duas convivem, cada uma no seu lugar?

---

## 10. 16/08/2026 — o lançamento passou a ter dono (e o que isso destravou)

Ponto de partida da sessão: a carteira do POP trabalhista mostrava **pago R$ 0,00** com
R$ 172 mil de honorários lançados no caso 88. A causa é o §3 deste documento — a RPC
soma `jm_pagamentos.valor_pago`, e essa coluna está preenchida em **10 de 1.022** linhas.

### 10.1 `jm_lancamentos.parte_id` — conciliação por chave, não por texto

Colunas novas (aditivas): `parte_id` (FK para `jm_partes`) e `parte_conciliacao`, que
registra COMO cada linha casou. Mesmo desenho de `jm_pagamentos`, que já tinha `parte_id`
em 100% das 1.022 linhas — o lado dos pagamentos nunca precisou de conciliação por nome.

Três passes, do mais seguro ao mais frouxo, sobre as 1.441 linhas de cota do cliente
(categoria `Indenização`; honorário, comissão e despesa não têm parte):

| | Linhas | Regra |
|---|---|---|
| `EXATO` | 1.356 | CNJ + nome normalizado (sem acento, espaço colapsado) idêntico |
| `PREFIXO` | 59 | nome truncado **e candidata única** no CNJ |
| `REVISAR` | 26 | não resolvido — não se adivinha |

**98,2% com dono.** O passe de prefixo exige candidata única de propósito: dois irmãos
"SOARES RODRIGUES" no mesmo CNJ vão para revisão, nunca para o chute. Os 4 casos que ele
resolveu, conferidos um a um: `Chloe`→CHLOE ISABELLA AMARAL VIANA, `JOSE CARLOS FERREIRA
DIAS`→JOSÉ CARLOS FERREIRA, `FRANCISCA SOARES NETO`→FRANCISCA SOARES NETO RODRIGUES,
`MARIA MARCELINA SANTOS (HERDEIRAS)`→MARIA MARCELINA SANTOS.

### 10.2 Descoberta: o buraco era falta de parte, não grafia

Antes de conciliar, a hipótese era divergência de escrita. Medido: das 362 linhas que não
casavam, **340 eram de CNJ sem NENHUMA parte cadastrada** e só 22 eram grafia. Daí a ordem
que se provou certa — **completar as partes primeiro, conciliar depois**. Fazer o inverso
teria resolvido 6% e deixado a impressão de que o resto era "nome errado".

Foram criadas **21 partes em 12 CNJs**, e antes delas **12 fichas em `jm_processos`**: a FK
`jm_partes.processo_cnj → jm_processos` exige o processo primeiro, e esses 12 tinham
dinheiro lançado sem nunca terem entrado na jurimetria (são 22 assim em toda a base).
As fichas nasceram com `caso` (da planilha), `uf_proc` (derivada do CNJ) e
`flag = 'FICHA_MINIMA_CADASTRAR_COMPLETO'` — `origem` só aceita INTERNO/EXTERNO.

**Erro cometido e revertido na hora:** a query das partes alcançou 38 pessoas em vez das 21
combinadas, incluindo CNJs do grupo de revisão manual. Veio `HS` (sigla de honorário
sucumbencial) virando "parte", `GABRIELA` sem sobrenome, e as herdeiras do
`0018250-98.2017.5.16.0007` duplicadas em duas grafias. As 17 excedentes foram apagadas
antes de qualquer coisa referenciá-las. **Lição: filtro de conciliação não serve como
filtro de cadastro** — o primeiro pode ser largo, o segundo tem que ser a lista exata.

### 10.3 UF derivada do CNJ

`lead_processes.estado_origem_sigla` estava preenchida em 85 de 475 processos do POP
trabalhista (18%), o que tornava inútil qualquer filtro por estado. A UF foi derivada do
próprio CNJ (TRT para ramo 5, TJ para ramo 8) em **302 processos** → **81% de cobertura**.

O mapa não foi assumido de cabeça: foi **conferido contra os 63 processos que já tinham UF
cadastrada — 63 acertos, 0 divergências**, incluindo os que a memória erra (TJSP=`8.26`,
TJSE=`8.25`). Ficaram de fora os TRTs que cobrem dois estados (8 PA/AP, 10 DF/TO, 11 AM/RR,
14 RO/AC), o ramo federal e 7 números fora do padrão CNJ — nesses o número não diz o estado.
Backup em `zz_uf_derivada_cnj_bkp_20260816` (id + valor derivado); rollback é
`set estado_origem_sigla = null` onde bate com o backup.

### 10.4 O que ainda trava o `valor_pago` — decisão pendente

Cruzando `jm_pagamentos (parte_id, n_parcela)` com os lançamentos já conciliados:

| | Parcelas |
|---|---|
| casam com lançamento | 492 (R$ 5.728.212,60 realizados) |
| … e já marcadas `RECEBIDA` | 315 |
| … mas com status ≠ `RECEBIDA` | 177 ← dinheiro lançado, status não atualizado |
| `RECEBIDA` **sem** lançamento | 398 (284 cuja parte não tem lançamento nenhum) |
| `PREVISTA` sem lançamento | 110 (108 com data futura — correto) |

Gravar `valor_pago` só com o que casa cobriria 492 de 713 recebidas. **Não foi gravado**:
metade preenchida engana mais que zero, e as 398 exigem saber se o dinheiro não entrou, se
entrou sem lançamento, ou se o `RECEBIDA` está errado.

E há uma regra do vocabulário que impede coluna única: **cota do cliente e honorário são
recebíveis distintos e nunca se somam**. `valor_pago` como um número só já nasce ambíguo —
o desenho certo é separar as duas linhas antes de gravar qualquer coisa.

### 10.5 A NF é o carimbo do honorário; o silêncio é o carimbo da parcela

Duas regras de negócio que o Raym trouxe e que os dados confirmaram:

**1. NF preenchida = honorário recebido.** A nota se emite quando o escritório recebe;
cota do cliente não gera nota. Confere: em 925 linhas de "a receber" (honorário e
indenização) **nenhuma** tem NF. Mas a NF está preenchida em poucos casos — no caso 88,
das 10 linhas de honorário realizado só a parcela 1 tem nota (R$ 10.909,09 de
R$ 172.288,53). Na base: R$ 7,17 mi com NF contra R$ 2,79 mi sem. Ou seja, **NF prova
faturamento, não recebimento** — serve para saber o que falta faturar, não para ser a
régua do "pago".

**2. No silêncio do executado, presume-se pago.** Quando fica inadimplente, o exequente
se manifesta nos autos. A *ausência* de movimentação depois do vencimento é sinal, e
isso virou `vw_jm_parcela_leitura`: `PAGO` (351 parcelas, R$ 5,10 mi),
`PAGO_PRESUMIDO` (368, R$ 583 mil), `INADIMPLENCIA_SUSPEITA` (88, R$ 826 mil),
`A_RECEBER` (215). Validada contra o caso 88, que sai 1–8 `PAGO` e 9–11
`INADIMPLENCIA_SUSPEITA` — a história real.

### 10.6 O marco "Levantamento / pagamento" era um sinal errado

O TPU **277** ("Convenção das Partes para Satisfação Voluntária da Obrigação em Execução")
estava cadastrado como sinal do marco `pagamento` em **10 POPs**. Isso não é levantamento
— é o combinado de COMO pagar. Como `pagamento` tem ordem 24 e `execucao_iniciada` tem 20,
o processo subia ao topo da régua e travava: o caso 88 ficou 846 dias em "Levantamento /
pagamento" tendo ido para execução com IDPJ.

Sinal removido (backup em `zz_pop_marco_sinais_bkp_20260816`) e marcos recalculados. Depois
disso, **`process_pop_marcos` não tem NENHUM marco `pagamento` na base inteira** — nunca
houve detecção real de pagamento. O código certo existe e está sem sinal: **12548
"Expedição de alvará de levantamento"**.

Para auditar o resto, duas views novas:

- `vw_pop_tpu_cobertura` — código TPU visto × sinal cadastrado. Hoje: 180 códigos, 36 com
  sinal, **144 sem sinal tocando 4.146 processos**, dos quais 47 tocam 10+ processos.
- `vw_pop_sinais_ociosos` — sinal que nenhum movimento casa. Hoje: 0.

Armadilha do método: **não casar por texto**. O código 12066 é "Cumprimento de Levantamento
da Suspensão" (59 processos) e casaria com "levantamento" sem ter nada a ver com dinheiro.

### 10.7 Etiqueta ≠ marco (decisão do Raym)

IDPJ e inadimplência **não viram marco**: nem todo processo passa por eles, e entrariam no
denominador do progresso. A régua já tem os campos para isso em `pop_marcos`:
`eventual` (fora do progresso), `atravessa_fases` (estado que não sequestra a fase — já
usado por *Acordo homologado* e *Suspensão*) e `terminal`. Etiqueta nova entra como
`eventual = true` + `atravessa_fases = true`.

Nota: hoje **os 27 marcos do POP trabalhista estão com `eventual = false`**, ou seja perícia
e embargos contam como etapa obrigatória de todo processo — o progresso está subestimado
para quem não passa por eles.

### 10.8 O grupo do WhatsApp como ponte para o processo sem ficha

**O problema:** 485 processos da jurimetria não têm lead nem caso cadastrado. Não existe
chave que ligue `jm_processos` a `lead_processes` para esses — ninguém nunca cadastrou.

**A ponte (ideia do Raym):** o grupo de WhatsApp onde os clientes são informados tem o nº do
caso no nome ("Caso 88 - ..."), e o mesmo nº está em `jm_processos.caso`. Casando por ele,
sai lead + caso + processo + partes de uma vez.

**Regra de casamento — só pelo inteiro.** "Caso 10.1 Marlene" e "Caso 11.1 Orileia" usam o
sufixo para OUTRA parte/processo do mesmo caso. Casar com o sufixo juntaria pessoas
diferentes; a regexp captura só o inteiro (`caso\s*n?º?\s*([0-9]{1,4})`).

**Onde ficou:** `vw_grupo_processo_conciliacao` (migration
`20260817190000_vw_grupo_processo_conciliacao.sql`), consumida pela coluna **Processo** da
aba *Contatos > Grupos* em modo auditoria — a tela de conciliação que já existia e só não
sabia de processo.

Medido em 17/08/2026: **224 grupos** com nº de caso no nome, **93 com CNJ vindo do lead**,
**131 só na jurimetria** (processo existe, ficha não), **2 ambíguos**.

Armadilha do grão: `whatsapp_groups_index` guarda uma linha por
`(group_jid, instance_name)`. A v1 da view não tinha `DISTINCT ON (group_jid)` e devolvia
1.040 linhas para 224 grupos — o mesmo grupo repetido até 11 vezes.

O que a tela **não** faz: nada aqui escreve. `cnj_sugerido` é sugestão, mostrada em verde
(ou âmbar com ⚠ quando `qtd_sugerida > 1`), e não vira `lead_processes` sozinho. Vínculo
automático em caso ambíguo criaria ficha para a pessoa errada.

### 10.9 As 232 peças lidas — e o que elas mudaram (e o que não)

`jm_ler_disparar(p_limit)` solta a fila por pg_net; `jm-ler-peca` lê e grava em
`jm_documento_leitura`. 232/232 lidas, confiança média 0,96–1,00.

O que saiu:

| espécie | peças | inadimplência | condenação somada |
|---|---:|---:|---:|
| DESPACHO | 154 | 8 | R$ 1,71 mi |
| ATA_AUDIENCIA | 34 | 0 | R$ 4,80 mi |
| DECISAO | 26 | 1 | R$ 4,03 mi |
| SENTENCA | 7 | 0 | R$ 2,00 mi |
| EXTINCAO_QUITACAO | 7 | 0 | — |
| ACORDO | 3 | 0 | R$ 1,61 mi |

**Inadimplência em 5 processos**, nenhum deles visível pelo DataJud — o caso 88
(IDPJ + penhora de R$ 21.769,35, o mesmo valor que a Luana anotou à mão),
descumprimento de acordo com multa de 10% em `0000249-26.2020.5.14.0004`, e
10 parcelas pendentes em `0000604-65.2019.5.06.0401`.

**O ganho na régua foi modesto, e é honesto dizer:** `INADIMPLENCIA` foi de 15
para 30 parcelas e `PRECISA_LER` de 297 para 282. O **valor** em `PRECISA_LER`
não mudou (R$ 583.622,06) — as 15 parcelas que saíram têm `valor_previsto` nulo.
A razão é simples: só **22 processos** têm parcela em `PRECISA_LER` e só **19**
têm PDF baixado. O gargalo não é leitura, é coleta.

**Primeiro alvará detectado da base.** Fora da fila, 4 peças com título de
dinheiro foram lidas à mão: alvará de **R$ 153.677,91** (08/10/2024,
`0002701-92.2017.5.22.0003`) e comprovantes de R$ 25.330,28 e R$ 2.000. Até aqui
`process_pop_marcos` não tinha NENHUM marco `pagamento` na base inteira (§10.6).

Armadilha reconfirmada: das 18 peças com "comprovante/alvará" no título, a
maioria é comprovante de **residência**, de **postagem** e **AR dos Correios**.
Por isso a v3 da `vw_jm_parcela_leitura` decide pelo que a peça DIZ
(`jm_documento_leitura.especie`), não pelo título.

Ressalva registrada na v3: "intimado a comprovar o recolhimento das custas" é
inadimplência do PROCESSO, não da parcela do cliente — 2 dos 5 processos
marcados falam só disso, e a view os descarta por heurística de texto. Heurística
serve para desqualificar, nunca para classificar sozinha.

Faltam **1.074 peças** já baixadas e ainda não lidas (fora da fila porque seus
processos não têm parcela pendente). Custo estimado: ordem de US$ 1–3 no Gemini
2.5 Flash.

## 11. 17/08/2026 — "Pago R$ 620 mil" com R$ 3,3 milhões de honorário lançado

O painel **Carteira · Trabalhistas judicial — marcos** mostrava `Pago:
R$ 620.129,86` enquanto a planilha de lançamentos tinha mais de R$ 10 milhões em
`Honorários`. Nada estava somando errado — eram três problemas empilhados.

### 11.1 O chip PAGO nunca foi dinheiro

`EstagioChips` soma **valor de condenação** por estágio, não valor recebido. O
chip PAGO é "quanto valem os processos que já têm pagamento registrado". Medido
na RPC `pop_carteira_marcos` em 17/08/2026:

| estágio | partes | CNJs | valor (condenação) | valor_pago |
|---|---|---|---|---|
| CONDENACAO | 236 | 103 | 16.609.393,39 | 0 |
| A_RECEBER | 61 | 41 | 3.062.710,00 | 0 |
| **PAGO** | **17** | **3** | **620.129,86** | **874.124,24** |
| EM_EXECUCAO | 17 | 17 | 0 | 0 |
| PROJETADO | 344 | 318 | 0 | 0 |

Os dois números de "pago" na mesma tela (620.129,86 no chip, 874.124,24 no card)
são contas diferentes da mesma linha — e nenhuma das duas é o caixa do
escritório.

### 11.2 O estágio PAGO enxerga 3 de 475 processos

`pop_carteira_marcos` decide o estágio por `jm_pagamentos`
(`when coalesce(pg.total_pago,0) > 0 then 'PAGO'`). `jm_pagamentos` tem 1.022
linhas em **39 CNJs** no banco inteiro, e só **3** deles estão neste POP de 475.
Os outros 472 processos não têm como sair de PROJETADO/CONDENACAO, por
construção — não é dado faltando, é a régua não alcançando.

### 11.3 A planilha estava no banco e ninguém lia

`jm_lancamentos` (4.364 linhas, último import **08/07/2026**) tinha o dinheiro.
O único código que a lia era `vw_jm_parcela_leitura`, filtrando
`categoria = 'INDENIZAÇÃO'` exato — honorário ficava de fora por construção.
`cnj_na_base` está **NULL nas 4.364 linhas**: a coluna nunca foi preenchida.

### 11.4 O recorte do que é honorário RECEBIDO

Fechado com contagem no banco, não por nome de categoria:

- `Honorários` — **é caixa**. 523 linhas, R$ 9,96 mi. Todas com data no passado.
- `Honorários a receber` — **não é**. Lançamentos datados em 2027, 2030, 2035,
  2037 (pensionamento mês a mês). É previsão.
- `Honorários Adiantados Oriz` — **não é**. Antecipação de fundo; uma linha só
  responde por R$ 3,0 mi de caixa contra R$ 888 mil de competência.
- `Honorários adv parceiro` — **não é**. Repasse a terceiro (`tipo_raw` =
  'Repasse').

Regra que ficou no código: `categoria = 'Honorários'` exata, `tipo` ENTRADA ou
nulo, `data <= hoje`.

### 11.5 Onde o honorário cai (e onde some)

Dos honorários da planilha, por destino do CNJ:

| destino | lançamentos | valor |
|---|---|---|
| CNJ deste POP trabalhista | 110 | **3.302.102,03** |
| CNJ que não existe em `lead_processes` | 506 | 7.334.843,40 |
| sem CNJ no lançamento | 128 | 4.320.873,06 |

O buraco maior não é de cálculo: é **cadastro**. Metade do honorário aponta para
processo que não está na base.

### 11.6 O que foi entregue

`useCarteiraDoPop` passou a ler `jm_lancamentos` direto (RLS já permite select
para `authenticated`; sem RPC nova, sem DDL) e expõe:

- `totais.honorarioRecebido` / `honorarioLancamentos` / `honorarioCnjs` /
  `honorarioUltimo` — segue o recorte da busca, como o resto do dinheiro;
- `honorarios` — total da planilha, quanto está fora da carteira e quanto está
  sem CNJ, para a tela mostrar o buraco em vez de escondê-lo.

O painel ganhou a linha **"Honorários recebidos (caixa)"**, separada dos chips de
estágio, e o aviso passou a dizer o que o chip PAGO é. **As duas contas nunca se
somam**: honorário é a fatia do escritório, a carteira é o processo inteiro.

Provas em `useCarteiraDoPop.test.ts`: honorário conta uma vez por CNJ (p1 tem 2
partes — por linha daria 32.000 em vez de 17.000) e segue o recorte da busca.

### 11.7 O que ficou de fora

- **Reimportar a planilha.** O import é de 08/07/2026: 523 linhas de
  `Honorários` no banco contra 575 na planilha do Raym. Os números acima estão
  ~1 mês atrasados.
- **Conciliar lançamento → estágio.** O estágio PAGO continua olhando só
  `jm_pagamentos`. Fazer o lançamento contábil mover o estágio exige casar por
  parte (`parte_id` está preenchido em 1.415 de 4.364 linhas) e muda o valor de
  todos os chips — não foi feito, e não deve ser feito sobre base de julho.

## 12. 17/08/2026 — o dicionário do CONTROLE FINANCEIRO (jm_lancamentos)

Confirmado com o Raym e com o PDF da planilha viva: `jm_lancamentos` é o import
do CONTROLE FINANCEIRO GRUPO PRUDÊNCIO, e a convenção central é:

**A parcela nasce como "X a receber" e vira "X" quando o dinheiro cai.**
`Honorários a receber` / `Indenização a receber` são o CRONOGRAMA (parcela a
parcela, coluna `data` = vencimento, `n_parcela` = número); `Honorários` /
`Indenização` são o realizado. O objetivo do parcelamento registrado é controlar
o que dá para ADIANTAR ao cliente. Na coluna `pessoa`, honorário vem como
HC (contratual) / HS (sucumbencial); indenização vem com o nome do cliente.

### Famílias de categoria (import de 08/07/2026, 4.364 linhas, regime de caixa)

Entradas de processo: Indenização (742 c/ INDENIZAÇÃO e Atrasado, R$ 15,08 mi);
Honorários (523, R$ 9,96 mi); Honorários a receber (444, R$ 5,63 mi, até 2039);
Honorários Adiantados Oriz (11 em 2 grafias, R$ 3,89 mi — antecipação de fundo);
Indenização a receber (481, R$ 2,00 mi); Bradesco (1, R$ 495 mil);
Indenização comprada (223, R$ 241 mil); Honorários adv parceiro (21 em 2
grafias, R$ 133 mil — repasse); Parceria/Parceira (5, R$ 64 mil).

Saídas: Movimentação conta (329, R$ 2,63 mi — transferência interna, não é
despesa); FOLHA FIXO (487, R$ 1,94 mi); Empréstimo Bancário (23, R$ 948 mil);
Imposto (38, R$ 749 mil); folha variável (~560 linhas em SETE grafias,
~R$ 545 mil); OUTROS em 3 grafias (261, R$ 287 mil); ajuda família em 5 grafias
(129, R$ 45 mil); PREVIDENCIÁRIO (46, R$ 24 mil); miúdas pessoais de 2023.

### O que a tabela está pedindo (medido, não resolvido)

- **"A receber" com data vencida**: R$ 5,05 mi em honorários e R$ 886 mil em
  indenização. Ou VENCIDO real, ou pago sem reclassificar (caso 88, parcelas
  9–11 de 2025, continuam "a receber"). Ninguém sabe qual dos dois sem conferir.
- **Grafias**: qualquer soma por categoria tem que normalizar antes.
- **`jm_pagamentos` diverge da planilha**: no caso 139 ela tem UMA parcela de
  indenização (R$ 14.749,15) contra R$ 149 mil de fato recebidos
  (R$ 58.496,07 de honorário + R$ 90.993,74 de indenização, ago/2025–jun/2026).
  É ela que alimenta o "pago" e o estágio PAGO da carteira — aposentá-la em
  favor de `jm_lancamentos` é o caminho, mas só depois de reimportar a planilha
  (import atual: 08/07/2026).

## 13. 18/08/2026 — reimport da planilha e o buraco de cadastro medido

### 13.1 Reimport de `jm_lancamentos` (diff por hash, não swap)

A planilha atualizada (Drive, `Lancamentos_honorarios`, salva em 17/08) foi
reimportada por **diff de conteúdo**: hash md5 por linha nos dois lados,
deletar o que sumiu, inserir o que mudou/nasceu. 4.364 → **4.742 linhas**
(+450 inseridas, −72 removidas). Vantagem do diff sobre truncate+reload:
as ~4.290 linhas intactas **preservaram `parte_id`/flags** de graça.

Verificação (banco = planilha, ao centavo): Honorários 578 / R$ 10.214.145,26;
Indenização 793 / R$ 15.237.242,09; Honorários a receber 680 / R$ 5.816.833,01;
Indenização a receber 503 / R$ 2.581.438,92. `importado_em` = 18/08/2026.
Backup de rollback: `zz_jm_lancamentos_bkp_20260818` (remover após 24h).

Armadilhas de normalização que geraram falso-diff (e as regras que ficaram):
o import antigo gravou `conta` em MAIÚSCULA e NF numérica sem `.0` — o
comparador precisa de `upper(conta)` e float-inteiro→int em TODO campo texto.
Datas impossíveis na planilha (29/02/2022 ×6) já estavam como NULL no banco.
Conciliação das linhas novas de cota: +54 EXATO, +4 PREFIXO, 49 REVISAR
(CNJ novo ainda sem parte em `jm_partes` — padrão do §10.2).

### 13.2 Resposta ao "não está faltando processo no POP trabalhista?" — SIM

Cruzando TODO CNJ trabalhista (J=5) com dinheiro na planilha contra
`lead_processes` (base inteira, qualquer board):

| onde está o CNJ trabalhista | CNJs | recebido | a receber |
|---|---|---|---|
| no POP trabalhista — marcos | 36 | R$ 6,61 mi | R$ 5,36 mi |
| **sem ficha NENHUMA na base** | **52** | **R$ 15,16 mi** | **R$ 2,75 mi** |

O grosso do dinheiro histórico está em processo que nunca entrou no sistema
(safra pré-WhatsJUD). Maiores órfãos: 0000084-44.2020.5.08.0101 (R$ 1,65 mi),
0000417-95.2022.5.08.0110 (R$ 1,14 mi), 0000923-88.2025.5.11.0011 (R$ 1,13 mi),
0000919-35.2021.5.05.0342 (R$ 1,08 mi) — 52 ao todo. Cadastrar essas fichas é
o que faz a carteira e o caixa finalmente contarem a mesma história.
(Fora do ramo trabalhista: mais 13 CNJs sem ficha, R$ 202 mil.)

### 13.3 "A receber" vencidas, pós-reimport

101 parcelas de honorário (R$ 5,00 mi, 41 casos) e 125 de indenização
(R$ 771 mil, 9 casos) com data ≤ hoje e categoria ainda "a receber".
Ou atraso real (VENCIDO) ou pago sem reclassificar — separar caso a caso
continua pendente (a `vw_jm_parcela_leitura` v3 já faz isso por parcela
para indenização; honorário não tem equivalente).

### 13.4 Efeito no painel

"Honorários recebidos (caixa)" do POP trabalhista: R$ 3,30 mi → **R$ 3,49 mi**
(130 lançamentos, 29 CNJs, último em 10/08/2026), sem mudar código — a linha
lê `jm_lancamentos` direto.

### 13.5 Conferência POP × Tab.Aux × grupos WhatsApp (18/08/2026)

A Tab.Aux (import de 16/08 em `jm_processos`: 356 CNJs / 337 casos) cruzada
com `lead_processes` e com os nomes de grupos do WhatsApp:

- **147 processos SEM FICHA** no sistema (Tab.Aux e/ou lançamentos) —
  R$ 15,4 mi recebidos e R$ 3,1 mi a receber fora do radar da carteira.
- **15 processos com ficha em OUTRO board** (fora do POP marcos).
- **39 casos têm grupo no WhatsApp e nem na Tab.Aux estão** (maior: 413) —
  a Tab.Aux em si está incompleta; a régua real de casos são os grupos.
- Justiça comum entra no POP normalmente (40 CNJs J=8 já estão lá) —
  acidente estadual não é motivo para ficar de fora.

Entregue ao Raym: `Conferencia_POP_trabalhista_20260818.xlsx` (3 abas:
sem ficha, outro board, grupo sem Tab.Aux). Detecção de caso nos nomes de
grupo: regex `(CASO|FAMILIA|FAMÍLIA)` + número em `conversations.contact_name`
e `lead_whatsapp_groups.group_name`.

### 13.6 As 162 fichas criadas no POP marcos (18/08/2026)

Autorizado pelo Raym ("cria tudo"): as 147 sem ficha + 15 que só existiam em
outro board ganharam ficha própria no board `Trabalhistas judicial — marcos`
via INSERT em `lead_processes` (sem lead vinculado; `notes` explica a origem;
`workflow_stage_id = m_ajuizamento` como ponto de partida; guarda
anti-duplicidade por CNJ dentro do board). As fichas dos outros boards foram
MANTIDAS — o sistema convive com o mesmo CNJ em boards de produtos diferentes.

Verificado pós-criação:
- Carteira do POP: 475 → **637 processos** (475 + 162, dedup ok).
- Honorário recebido que o POP enxerga: R$ 3,49 mi → **R$ 8,61 mi** (87 CNJs).
- CNJs com honorário recebido e sem ficha: **0** (zerou o buraco de cadastro).

Ressalvas: (a) as fichas novas entram como PROJETADO/sem marco até a captura
(Escavador/DataJud/jurimetria) preencher; (b) continuam SEM lead — vincular ao
cadastrar o caso no funil; (c) `0000240-19.2025.5.11.0152` e `.0153` (caso 368)
vieram os dois da Tab.Aux — um deles é provável typo, conferir; (d) honorário
de INSS sem CNJ (SM/BPC, ~R$ 1,3 mi) segue fora da carteira por natureza —
não tem processo judicial.

### 13.7 Correção caso 368/382 — e a validação por dígito verificador (18/08)

O Raym pegou: os CNJs `0000240-19.2025.5.11.0152` e `.0153` (caso 368, Tab.Aux)
NÃO EXISTEM — alguém arrastou a célula no Sheets e o Google incrementou o final
do número. Os processos reais do caso 368 (confirmados pelas notificações dos
grupos FAMÍLIA 368 e 368.1) são `0000240-19.2025.5.11.0151` (JT, companheira e
filha) e `0007908-17.2025.8.04.4700` (TJAM, pais e irmãos) — e JÁ TINHAM ficha
no POP desde junho.

**Guarda nova**: CNJ tem dígito verificador (ISO 7064 mod 97-10) — validado em
SQL: `mod((seq||ano||J||TR||origem)::numeric*100 + DV, 97) = 1`. Rodada sobre
fichas do POP + Tab.Aux + lançamentos, pegou os 2 do caso 368 **e um terceiro
que ninguém tinha visto**: `0810452-32.2026.8.18.0046` (caso 382), DV inválido.
Toda importação futura de CNJ deve passar por essa validação.

Correções aplicadas: 3 fichas criadas em 13.6 apagadas (soft delete);
`jm_processos` limpo (.0152/.0153 removidos, estadual 0007908 inserido no caso
368, caso 382 flagged CNJ_INVALIDO_DV); 6 partes (P0146–P0151: mãe e irmãos)
remapeadas do CNJ errado para a ação estadual. POP: 637 → 634 fichas ativas.
Pendente: número certo do caso 382 (confirmar com o time).

**Busca por OAB**: a edge `search-escavador` já tem `buscar_por_oab` — é o
caminho para o inventário definitivo de processos do Raym (fecha os 39 casos
sem CNJ e valida a Tab.Aux inteira), pendente de OK por custo de créditos.

### 13.8 Inventário por OAB via Escavador — rodado (18/08)

Autorizado pelo Raym ("pode pesquisar" → as 3 OABs). Inscrições no CNA:
**PI-10949** (principal), **CE-56635-A** e **PA-39418-A** (suplementares).

**Como rodou** (rede do ambiente bloqueia chamada direta): edge
`search-escavador` v17 (fix do `buscar_por_oab`: endpoint v2
`/advogado/processos` + paginação aceitando o `links.next` inteiro como
`cursor`, porque ele carrega `cursor`+`li` e só o cursor dá 422), invocada de
dentro do Postgres com `pg_net` orquestrado por `pg_cron` a cada 15s
(`zz_escavador_tick()`: dispara página, espera resposta em
`net._http_response`, grava em `zz_escavador_oab_raw`, segue o `next`, promove
a próxima OAB, se auto-desagenda no fim).

**Resultado**: PI-10949 = 2.076 processos (21 páginas), CE-56635 = 14,
PA-39418 = 133 (129 repetidos da PI, 4 exclusivos). **Deduplicado: 2.075 CNJs
distintos** — 776 trabalhistas, 927 estaduais, 370 federais (inclui INSS),
2 STJ. Normalizado em `zz_escavador_processos` (uma linha por CNJ: data de
início, ramo pelo dígito J, polos, área/classe/assunto, órgão, valor da causa,
OABs de origem).

**Cruzamento com o WhatsJUD** (`zz_inventario` = Escavador ∪ jm_processos ∪
Tab.Aux ∪ lead_processes, 2.126 CNJs):
- 724 dos 2.075 têm ficha em algum board; 582 no POP marcos.
- **413 trabalhistas sem ficha em board nenhum** — maioria antiga (2016–2018:
  181; 2025–26: 67). Decidir escopo antes de criar ficha em massa.
- 938 não-trabalhistas sem ficha (estaduais/federais — INSS, cível, etc.).
- **51 CNJs só nas bases internas** (não vieram na busca por OAB): conferir se
  o Raym não é o advogado cadastrado ou se o CNJ está errado.
- DV inválido: os 2 conhecidos (368/382) + 2 CNJs legados do próprio Escavador
  (2007/2017, numeração pré-CNJ que não fecha o mod 97).

**Entregue**: `Inventario_Processos_OAB_20260818.xlsx` — inventário completo
ordenado por **data de protocolo** com **nº do caso** (fonte: jm_processos >
Tab.Aux > título da ficha), abas: completo, trabalhistas sem ficha, fora do
Escavador, resumo. Era o pedido literal do Raym ("a sequência dos processos
pela data de protocolo e trazendo o numero do caso").

Trabalho: tabelas `zz_escavador_*` e `zz_tabaux` ficam até a decisão sobre as
fichas; depois dropar. Cron `zz-escavador-oab` já se desagendou (verificado).

**Fichas criadas (18/08, autorizado pelo Raym: "pode criar os de 2020 em
diante")**: 182 fichas no POP marcos — trabalhistas do Escavador de
2020-01-13 a 2026-07-01 sem ficha em board nenhum, DV validado, guarda
anti-duplicidade por CNJ no board. Título = polo ativo (cliente); nota traz
data de protocolo e polo passivo; estágio inicial `m_ajuizamento`; sem nº de
caso e sem lead (nenhum consta nas bases internas — vincular quando
identificado). Board: 874 → 1.056 fichas ativas (827 CNJs distintos, zero
duplicado). Ficaram FORA por decisão: 231 trabalhistas anteriores a 2020 e
938 não-trabalhistas.

**Complemento (18/08, "pode pegar casos antes de 2020")**: +231 fichas — os
trabalhistas do Escavador de 2013–2019 sem ficha em board nenhum, mesmo padrão
(DV validado, anti-dup, título = polo ativo). Board: 1.056 → **1.287 fichas
ativas** (1.057 CNJs distintos). Com isso, TODO trabalhista do inventário
Escavador tem ficha no POP marcos, com uma exceção deliberada:
`0001078-27.2025.5.11.0000` (incidente 2º grau TRT11, polo ativo MPT) tem
ficha no board Fluxo BPC e ficou onde está.

**Caso 382 — desfecho da investigação**: o DV 32 de `0810452-32` não fecha com
NENHUM ano/tribunal (TJPI 2025 pediria DV 46; TJMA 2026 pediria 34) — o erro
está na própria sequência, não só no ano. As mensagens enviadas ao grupo
FAMÍLIA 382 (whatsapp_messages, 16 envios) citam UM único processo:
`0000997-70.2025.5.23.0121` (JT/TRT23, indenização), que JÁ tem ficha no POP
em `m_remessa_2grau`. O estadual `0810452-*` não aparece no Escavador nem nos
grupos — ou a ação não existe, ou o número está todo errado na planilha.
Flag do jm_processos atualizado com esse achado; ficha estadual segue sem
criar até confirmação na origem.

**Caso 382, ato final (18/08)**: o trabalhista `0000997-70.2025.5.23.0121`
EXISTE — confirmado por `buscar_por_numero` no Escavador: Vara do Trabalho de
Nova Mutum-MT (TRT-23), acidente de trabalho, ativo, 24 movimentações, e
**segredo de justiça** — por isso não aparece na consulta pública nem veio no
inventário por OAB (Escavador não expõe envolvidos de processo sigiloso).
Lição para os "51 fora do Escavador": processo em segredo de justiça é
falso-negativo esperado da busca por OAB — checar por número antes de
suspeitar do CNJ. O estadual `0810452-*` do caso 382 segue não confirmado.

### 13.9 Vínculos e marcos das fichas do inventário (18/08)

**Vínculos (item 1)**: batimento do polo ativo das 413 fichas novas contra
leads (20.210 nomes), legal_cases e 554 grupos WhatsApp. Conclusão honesta: a
maioria não existe nas bases internas — por isso nunca teve ficha. Aplicados
**7 vínculos inequívocos** (conferidos um a um): Arlan Max Galvão Farias (2
fichas, lead exato), Marcos Aurélio Pinheiro dos Santos, Raimundo Soares
Neves, CASO 252 (Marilan Domingos de Miranda), CASO 136 (Victor Gabriel,
TRT-19 = Delmiro Gouveia/AL), CASO 185 (Ítalo Azevedo, TRT-11 Manaus) — os
3 últimos com lead_id + case_id + título renomeado "CASO n — nome". Falsos
positivos rejeitados no fuzzy match: sobrenome comum ("Rodrigues dos
Santos"), cidade que parece nome ("Coelho Neto"), homônimo ("José Francisco
da Silva" 2016 ≠ caso 382). Lição: word_similarity sozinho NÃO serve para
vincular — só containment de nome completo + conferência manual.

**Marcos (item 2)**: das 413 fichas, o Escavador marca **79 ATIVAS** e 333
arquivadas (status_predito das fontes). Backfill rodado SÓ nos ativos, pelo
pipeline existente (`backfill-process-marcos`, mode backfill + process_ids,
lotes de 10 via pg_net orquestrado por pg_cron `zz-backfill-marcos`, mesmo
padrão do §13.8). Resultado: 8 lotes, 79 lidos, 79 com movimentações, capas
salvas, **84 marcos inseridos**, 48 candidatos descartados pela revisão IA,
0 erros. Status atual das fichas (view lead_process_current_status): 37
petição inicial, 10 pagamento, 4 trânsito em julgado, 2 acórdão 2º grau, 2
cumprimento de sentença, 1 sentença, 1 audiência de conciliação. As 333
arquivadas ficam sem consulta por decisão de custo — reavaliar se alguma
voltar a se mover (push por e-mail cobre).

**Confirmações do Raym (18/08)**: aplicados mais 9 vínculos da lista de
candidatos — caso 38 (2 fichas: Maria José Carlos de Sousa TRT-22 e Maria
José dos Santos Cunha TRT-16), caso 58 (Herculano Coelho Neto), caso 240
(Paulo Henrique Gomes Vieira), caso 308 (Antonio Alves de Araujo), caso 386
(3 fichas: Francisco de Assis Alves Barbosa TRT-8 ×2 e Francisco de Assis
Oliveira TRT-16 — ATENÇÃO: dois nomes distintos no mesmo caso, conferir se
o Oliveira de 2016 é mesmo o 386), e Francisco das Chagas Silva → lead
"Francisco das Chagas Silva do Carmo". Total de vínculos: 16.
Fora por decisão: `0004227-50.2023.5.20.0000` é MANDADO DE SEGURANÇA do
próprio Raym sobre honorários periciais contra o Juízo da VT de Nossa
Senhora da Glória (TRT-20/SE, out/2023) — processo do escritório, não de
cliente; segue sem lead. As 3 fichas com polo ativo MPT (ver §13.9) ficaram
para o Raym conferir contra os e-mails adm@/processual@.

**Correções pelos prints do Raym (18/08, manhã)**:
- Caso 386 DESFEITO nas 3 fichas: o cliente real é Francisco de Assis
  MENDES RESENDE (motorista × Kandango Transportes/Grupo Catedral e
  Expresso Maia) e a inicial ainda está em elaboração — a ação nem foi
  protocolada, por isso não há CNJ. Os dois Franciscos vinculados eram
  homônimos. Lição repetida: nome comum + grupo dedicado ≠ vínculo.
- `0010966-17.2024.5.18.0111` → **CASO 222** (consignatória de verbas
  rescisórias do Elenildo; MPT no polo — por isso o polo ativo enganava).
- `0000047-10.2025.5.06.0000` → **CASO 183.1** (Conflito de Competência do
  processo do Gedeon `0001271-63.2024.5.06.0017`, que já tinha ficha).
- `0010384-54.2020.5.18.0241` (ação) e `0011507-53.2021.5.18.0241`
  (cumprimento, CONCLUÍDO — parcela final repassada) → **CASO 2.2**
  (Iracema Costa Sousa e Demerval de Sousa, Valparaíso-GO). Sem lead no
  funil — só título/nota.
Total: 18 fichas vinculadas/nomeadas, 3 desfeitas.

**Limpeza (18/08)**: dropadas as tabelas de trabalho da rodada
(zz_escavador_*, zz_tabaux, zz_inventario, zz_vinculos, zz_match_*,
zz_grupos, zz_nomes_leads, zz_backfill_*) e as funções zz_escavador_tick /
zz_backfill_tick; crons zz-* zerados. `zz_jm_lancamentos_bkp_20260818` sai
automaticamente após completar 24h (agendado). Dados que importavam já
estão extraídos: planilha entregue, fichas criadas, capas e marcos salvos.

### 13.10 Plano aprovado: aposentadoria da Tab.Aux (próxima sessão)

Decisão do Raym (18/08): o sistema vira a fonte da verdade e a Tab.Aux se
aposenta — em vez de reimportar a planilha, absorver os dados de vez.

O que o banco JÁ tem: caso ↔ CNJ ↔ data de protocolo (jm_processos) e
fichas no POP para tudo. O que vive SÓ na planilha: as colunas por parte —
total da condenação, total da parte, total à vista, honorário contratual à
vista, status de pagamento, fase, decisão de mérito — exatamente os campos
previstos no vocabulário v4 para o grão (processo × cliente) em jm_partes
(cota_cliente_liquida, honorario_contratual, etc.).

Passos, na ordem:
1. **Ingestão** — parse completo de TODAS as seções da Tab.Aux (principal,
   previdenciário, arquivados, blocos laterais) → jm_partes + campos novos
   aditivos. De-para coluna a coluna mostrado ao Raym ANTES de gravar.
   Conciliação de âncora obrigatória: somas no banco batendo com a
   planilha ao centavo (mesmo método do reimporte do financeiro, §13.3).
2. **Tela de edição** no WhatsJUD — valores por parte na ficha do processo
   (junto com a seção de repasses jm_repasses já desenhada). Sem a tela, a
   equipe continua digitando no Sheets e as fontes divergem — NÃO aposentar
   a planilha antes deste passo.
3. **Congelamento** — Tab.Aux vira arquivo histórico somente-leitura; a
   importação periódica morre.

A planilha do CONTROLE FINANCEIRO (jm_lancamentos) segue viva por ora —
mesma lógica se aplicará depois, quando a seção financeira estiver rodando.

Gatilho combinado: o Raym abre a próxima sessão com "faz o passo 1 da
aposentadoria da Tab.Aux".

## 14. 21/08/2026 — os autos restritos: 14 tentativas, zero sucesso, e o erro que sumia

O certificado digital (RAYMSANDRESON, CPF 023.516.943-92, cadastrado no
Escavador em 10/07/2026, expira 10/07/2027) ganhou em 21/08 às 12:49 um método
TOTP "PDPJ (válido para todos os sistemas PJE)": 74 autenticações, 73 PJE + 1
SEEU. Isso cobre **446 dos 467 processos** da carteira (96%). Ficam fora TJSP
(10), TRF4 (3), TJMS (3), TJPR, TJAM, TJAL, TJSE e TRF6.

### 14.1 O placar

Treze processos foram disparados às 16:40 com `{autos:1, utilizar_certificado:1}`,
mais um teste controlado às 17:36. Resultado das 14:

| `autos_erro` | qtd |
|---|---|
| `SECRET_ERROR` | 8 |
| `LOGIN_ERROR` | 5 |
| `INTERNAL_ERROR` | 1 |
| SUCESSO | **0** |

`SECRET_ERROR` aparece em TRT-3, TRT-8, TRT-22 e TJMT — tribunais diferentes,
mesmo erro. Não é "tribunal não suportado": é o segredo TOTP não gerar código
que o PDPJ aceita. `LOGIN_ERROR` é a etapa anterior, o login com o certificado,
e só dá para separar os dois depois que o TOTP estiver de pé.

Até aqui o certificado nunca trouxe uma peça restrita: `jm_documentos` só tem
`tipo = PUBLICO` / `origem = escavador_publico`.

### 14.2 Falha de autos é estornada — só o sucesso custa

O header `Creditos-Utilizados` devolve 150 (R$ 1,50) no disparo, mas o saldo
subiu R$ 4,50 exatamente quando três solicitações concluíram com erro, e o teste
controlado não moveu o saldo nenhum centavo. **Testar autos é de graça; a conta
só começa quando funcionar.** Ordem de grandeza para quando funcionar: 446 ×
R$ 1,50 = **R$ 669** por varredura completa, contra R$ 89 em modo público.

### 14.3 O erro sumia — e por dois caminhos

As treze linhas ficaram gravadas como `SUCESSO / PUBLICOS`, `motivo_erro` vazio.
R$ 19,50 disparados (depois estornados), nenhum auto, nenhuma pista. Dois
apagadores, os dois na edge `esc-autos`:

1. ela só tratava `ultima_verificacao.status = 'PENDENTE'`; com `'ERRO'` seguia
   adiante, tomava um 422 genérico no `/autos` e rebaixava para PUBLICOS — o
   `SECRET_ERROR` ficava só na API do Escavador;
2. ao concluir a colheita ela gravava `motivo_erro = null`, e a colheita que
   conclui é a **pública**, feita depois do rebaixamento.

Corrigido com `jm_esc_solicitacoes.autos_erro` e `.autos_tentado_em`
(migration `20260821180000`). `autos_erro` só é limpo por uma colheita de autos
que funcionou — a pública não apaga mais. Verificado no
`0001838-13.2019.5.08.0115`: `acao=autos` devolve `SECRET_ERROR`, grava a
coluna, e o `SUCESSO` seguinte preserva o valor. As 14 tentativas foram
backfilladas a partir da API enquanto o dado ainda existia lá.

A edge, que até então **só existia deployada**, foi versionada em
`supabase/functions/esc-autos/index.ts`, com `verify_jwt = false` registrado no
`config.toml` — quem a chama é o `pg_net`, sem sessão; o gate é o `?k=` no
próprio código, e um deploy sem essa linha religaria o JWT e mataria o pipeline.

### 14.4 Onde isso parou

O `SECRET_ERROR` é do lado da credencial, não do nosso código — nada a fazer no
repo até o TOTP passar. O teste que decide: entrar no `portaldeservicos.pdpj.jus.br`
com o certificado usando um autenticador alimentado pelo **mesmo arquivo de QR
Code** que subiu no Escavador. Se o PDPJ recusar o código, o segredo está morto
(resetar o MFA no PDPJ e recadastrar, substituindo o método atual). Se aceitar,
o problema é do Escavador — abrir chamado citando as solicitações `54945127` e
`54942831`.

Não existe cron que reabra processos em modo `AUTOS`: a reabertura é sempre
manual, e é ela que define a conta. Enquanto a fila não tiver linha em
`A_ENVIAR`, a rotina roda de graça.

## 15. 25/08/2026 — o certificado funciona em UM tribunal, não em todos

O passo 1 do plano de varredura (processos com pagamento já lançado à mão, para
conferir a planilha de cálculo do processo contra o lançamento do Raym) foi
disparado em 25/08 às 02:16 UTC: cinco processos, cinco tribunais diferentes,
escolhidos pelo maior valor pago.

### 15.1 Placar: 0 de 5

| processo | tribunal | pago lançado | resultado | tempo |
|---|---|---|---|---|
| 0000084-44.2020.5.08.0101 | TRT8 | R$ 1.005.658,51 | `SECRET_ERROR` | 13,8 min |
| 0000672-06.2023.5.09.0655 | TRT9 | R$ 561.875,00 | `INTERNAL_ERROR` | 54,4 min |
| 0000407-35.2023.5.23.0066 | TRT23 | R$ 594.999,96 | `SECRET_ERROR` | 84,6 min |
| 0000453-61.2023.5.20.0016 | TRT20 | R$ 645.000,00 | `INTERNAL_ERROR` | 96,2 min |
| 0000407-37.2017.5.22.0110 | TRT22 | R$ 540.000,00 | **travado** | >183 min |

O TRT22 nunca concluiu. Ficou `PENDENTE` por mais de três horas — contra 49 min
do único sucesso e 96 min da falha mais lenta — e foi tratado como travado, sem
novo disparo. Não há status terminal para ele na API; é um sexto desfecho, nem
sucesso nem erro, e vale registrar porque uma fila em massa precisa de um teto de
espera: solicitação que não fecha ocupa vaga para sempre.

**Placar final do passo 1: 0 de 5.**

### 15.2 O mapa de cobertura, com tudo que já foi testado

| tribunal | resultado |
|---|---|
| **TRT15** | **SUCESSO** — 140 peças, 118 restritas (caso 88, 24/08) |
| TRT3 | `SECRET_ERROR` |
| TRT8 | `SECRET_ERROR` (21/08 e 25/08) |
| TRT9 | `INTERNAL_ERROR` (21/08 e 25/08) |
| TRT20 | `INTERNAL_ERROR` |
| TRT22 | `SECRET_ERROR` (23/08) |
| TRT23 | `SECRET_ERROR` |
| TJMT | `SECRET_ERROR` |

**Um sucesso em oito tribunais.** O "PDPJ (válido para todos os sistemas PJE)"
do painel do Escavador é uma lista de 165 sistemas, não um passe universal: o
TRT15 está nela e os demais testados, aparentemente, não — ou estão com um
segredo que o tribunal recusa.

### 15.3 A régua dos 25 minutos era artefato de lote — não use

A seção 14 registrou que as 13 falhas de 21/08 concluíram todas em 25,0–25,1
minutos, e daí se concluiu que passar de 25 min era sinal de sucesso. **Isso não
se sustenta.** As 13 foram disparadas no mesmo segundo e concluíram juntas
porque estavam na mesma leva de processamento do Escavador, não porque 25 min
seja limite de nada.

Medido em 25/08, com disparos igualmente simultâneos mas conclusões espalhadas:
`SECRET_ERROR` em 13,8 min e em 84,6 min; `INTERNAL_ERROR` em 54,4 e 96,2. O
único sucesso levou 49 min. **Tempo decorrido não prevê resultado.** Só o status
final conta.

### 15.4 O que isso faz com a conta da varredura

A conta deixa de ser "446 × R$ 1,50 = R$ 669" e passa a ser "quantos processos
estão em tribunal que o certificado alcança". Pelo que há hoje, pode ser fração
pequena da carteira.

Antes de gastar, o passo barato é **um processo por tribunal**, para levantar o
mapa de cobertura. Falha de autos é estornada (seção 14.2), então o mapeamento
custa zero e responde de vez.

Em paralelo, vale chamado no Escavador: oito tribunais, um único sucesso, mesmo
certificado e mesmo TOTP é argumento forte de problema do lado deles. Citar as
solicitações 55039016 (o sucesso, TRT15) e 55116672 / 55116673 / 55116674 /
55116675 / 55116676 (as falhas de 25/08).

Nenhuma planilha de cálculo foi lida ainda — a comparação entre o valor do
processo e o lançamento manual do Raym continua sem resposta.

---

## 16. 27/08/2026 — a carteira por dono do dinheiro, e a cota que veio zerada

Raym pediu a carteira separada por titular: "dizer o que é do cliente, o que é
honorários e o estágio de cada uma separada e somados... modo de visualização
tipo só honorários, só parte líquida do cliente, juntos... se inspire no design
do Banco Inter". Ao medir o dado para desenhar a tela, apareceu um buraco maior
que a tela.

### 16.1 O que a RPC entrega hoje

`pop_carteira_marcos` tem duas fontes de valor, e só uma sabe de quem é o
dinheiro. Medido no POP Trabalhistas judicial (`0bcd8be6…`), 1.660 linhas:

| Fonte | Partes | Condenação | Separa titular? |
| --- | ---: | ---: | --- |
| `decisao` (`jm_valores`) | 563 | R$ 31.992.263,78 | **não** — `cota_cliente` e `honorario_parte` voltam nulos |
| `tab_aux` (`jm_partes`) | 262 | R$ 60.149.473,03 | sim |
| sem valor | 835 | R$ 0,00 | — |

A decisão fixa **quanto o processo vale**, não quanto é de quem — isso está no
contrato e na conta de liquidação. Então 35% da carteira com valor não tem como
responder a pergunta do Raym, e nenhuma tela conserta isso: é peça que falta.

### 16.2 O "sucumbencial impossível" era a cota zerada

Na sessão anterior eu tinha classificado 258 partes com `hs > cota_parte_cjcm`
como sucumbencial inflado. Estava errado na causa:

```sql
select count(*) filter (where cota_parte_cjcm is null) cota_null,
       count(*) filter (where cota_parte_cjcm = 0)    cota_zero
from jm_partes where condenacao_cjcm is not null;
-- cota_null = 0 | cota_zero = 262   (de 688 partes)
```

**Zero importado, não nulo.** 262 das 688 partes com condenação vieram da
importação da Tab. Aux. com `cota_parte_cjcm = 0`. O honorário não está inflado
— a cota é que não está lá. No recorte do POP são **251 partes**, R$ 59,7 mi de
condenação e **R$ 30,2 mi sem dono** (`valor − cota − honorário`).

O conserto é a peça que traz o valor por parte (planilha de liquidação
homologada, termo de acordo, cálculo da execução), não um filtro na tela.

### 16.3 O que a tela passou a fazer

`CarteiraTitularPainel` (topo do sheet da carteira) e `CarteiraRelacaoSheet`:

- Seletor em pílula de três posições — **Tudo / Do cliente / Honorários**. Troca
  o número grande em vez de somar mais um card.
- `juntos` soma a **condenação**, que é o total que a carteira sempre mostrou.
  Não é `cliente + escritório` — se fosse, o total cairia de R$ 92,1 mi para
  R$ 30,0 mi sem um centavo ter saído do banco.
- A diferença vira `Cobertura.semDono`, escrita na dobra: separação conhecida,
  a decisão não separa, sem dono atribuído.
- Estágios na ordem da régua (PROJETADO → PAGO), cada um clicável, abrindo a
  relação linha a linha — uma linha por **parte** (processo × cliente), com soma
  no rodapé que bate com o card de origem.
- O aviso da cota zerada abre a relação **dessas** partes, e cada linha vai para
  a conferência anexar a peça. Aviso que não leva a lugar nenhum não é entrega.

Correção monetária aparece só no modo **Tudo**: o coeficiente é calculado sobre
a condenação da parte e ninguém repartiu ele entre cota e honorário — repartir
por regra de três seria dedução, não dado.

### 16.4 O que ainda falta

- Trazer a separação para as 563 partes de origem `decisao` — depende de ler a
  conta de liquidação, não de código.
- Corrigir as 251 partes de cota zerada pela esteira da conferência.
- `honorario_parte` soma HC (à vista + parcelado) e HS numa coluna só; separar
  os dois exige mexer na RPC.
