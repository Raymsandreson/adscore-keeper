---
name: whatsjud-fluxo-vocabulario
description: Vocabulário oficial dos estágios de fluxo de caixa e da estrutura de recebíveis da carteira jurídica (FIDC/WhatsJUD/Prudêncio Capital). Use SEMPRE que a conversa envolver classificação de recebíveis por estágio, relatório FIDC, fluxo de caixa da carteira, "cadê o dinheiro", o que é cessível/descontável, views jm_ (vw_jm_fluxo_mensal, vw_jm_kpi_linha_tempo), ou qualquer discussão sobre PROJETADO / CONDENAÇÃO / A RECEBER / VENCIDO / EM EXECUÇÃO / PAGO / DEPOSITADO EM JUÍZO. Use também quando o Raym pedir para classificar um caso, precificar deságio, decidir o que pode ser vendido ao fundo, separar cota do cliente vs honorário, montar relatório para gestora (Tercon) ou administradora (Limine), ou quando surgir dúvida sobre acordo vs condenação, à vista vs parcelado, trânsito em julgado, cessão de honorário, sucumbencial, ou crédito de menor depositado em juízo. Não invente estágios novos nem misture dimensões — esta skill é a fonte da verdade do vocabulário. Versão v4.
---

# Vocabulário de Fluxo de Caixa e Recebíveis — Carteira Jurídica FIDC (v4)

Fonte da verdade para classificar onde está o dinheiro de cada recebível da carteira e o que pode ser cedido ao fundo. Desenhado com o Raym para relatório FIDC, fluxo de caixa e retrato da operação. **Não crie estágios novos, não renomeie, não misture dimensões, não presuma.** Se algo não couber, isso é sinal para perguntar ao Raym, não para inventar.

## Mudança-chave da v4: a unidade é o CLIENTE, não o processo

Um processo pode ter vários clientes (litisconsórcio — típico dos casos de acidente com cônjuge + filhos + pais). **A unidade-base do fluxo é `(processo × cliente)`**, não o processo. Cada par cliente-processo tem seus próprios recebíveis, estágio, e decisão de cessão.

Metáfora: o processo é um **prédio**; cada cliente é um **apartamento**. Não se vende "o prédio" — vende-se apartamento por apartamento. Tudo (régua, cessão, depósito, correção) vive no nível do apartamento.

## Os dois recebíveis independentes (por cliente)

Cada cliente dentro de um processo gera DOIS recebíveis distintos, com donos diferentes e decisões de venda independentes. **Nunca some os dois; nunca trate um como o outro.**

| Recebível | Dono | Papel do Raym | Entra no ativo do FIDC? |
|---|---|---|---|
| **Cota do cliente** (indenização líquida: moral + estético + material, corrigida, líquida de honorário e custas) | o cliente | **corretor**: informa o valor atualizado; o cliente vende a quem quiser (qualquer fundo) | **NUNCA** — é dinheiro do cliente, não do fundo. Aparece só como dado informativo |
| **Honorário** (contratual + sucumbencial, corrigido) | o Raym | decide ceder ou não | **SÓ** se `honorario_cedido = sim` |

**Regra que protege contra conflito OAB:** o Raym é corretor da cota do cliente, não comprador. Ele informa o valor (dever de transparência) e o cliente vende a quem escolher. O conflito OAB (advogado que lucra no deságio do crédito do próprio cliente) só nasce se o fundo do Raym comprar a cota do cliente — evite; isso vai ao Dr. Camilo antes de virar linha de sistema.

## A pergunta única (para o ESTÁGIO)

Todo estágio responde "**Cadê o dinheiro?**". Decide-se por três eixos:
- **Tem valor certo?** (número real, não média estatística)
- **Tem data certa?** (data de pagamento concreta)
- **Está acessível/liberável?** (ou travado por restrição legal)

## A RÉGUA — 7 estágios (fonte da verdade)

| Termo | O que é | Valor | Data | Acesso | Pro FIDC |
|---|---|---|---|---|---|
| **PROJETADO** | sem decisão — valor é média por tipo de parte (cônjuge, filho, pais, vítima...) da curva histórica | estimado | estimada | — | potencial, **fora do fluxo** |
| **CONDENAÇÃO** | juiz fixou o valor, **sem data** de pagamento ainda | certo | incerta | — | firme, **não descontável** (falta cronograma) |
| **A RECEBER** | tem valor **e** data, no prazo — acordo a vencer, ou execução com data/valor provável | certo | certa (futura) | livre | **o ouro do FIDC — descontável** |
| **VENCIDO** | tinha data, passou, o devedor **concordou em pagar** e não honrou | certo | passou | — | risco de **crédito** (calote) |
| **EM EXECUÇÃO** | recebimento **forçado** (penhora/bloqueio); sem promessa voluntária. Execução recém-aberta já entra aqui, mesmo sem bloqueio | certo | processual | — | risco **processual** (quando/quanto sai) |
| **DEPOSITADO EM JUÍZO** | valor já depositado, mas **travado** por restrição legal (crédito de menor até os 18, ou honorário que o juiz só libera ao final) | certo | data de liberação (aniversário de 18, ou "ao final") | **travado** | **NÃO descontável** — garantido mas inacessível |
| **PAGO** | caiu na conta | certo | entrou | — | **realizado** |

Saída lateral (fora da régua): **INDEFERIDO** = o dinheiro que morreu (perdeu).

## As distinções que mais confundem — grave estas

### 1. CONDENAÇÃO vs A RECEBER — a diferença é a DATA
Ambas têm valor certo. CONDENAÇÃO não tem data (juiz fixou R$X, execução não andou); A RECEBER já tem data (acordo marcado, ou execução com data provável). A gestora antecipa A RECEBER; CONDENAÇÃO ela desconta com deságio maior. **Nunca junte na mesma coluna** — superestima o descontável. Isto resolve o "decisão sem trânsito ≈ R$17M": é CONDENAÇÃO.

### 2. VENCIDO vs EM EXECUÇÃO — a diferença é QUEM FALHOU
- **VENCIDO** = promessa quebrada. O devedor concordou (acordo/condenação aceita), tinha data, não pagou. Risco de **crédito**.
- **EM EXECUÇÃO** = ninguém prometeu; está sendo forçado por penhora. Risco **processual**. Pode ser mais seguro que um vencido (há penhora garantindo), só mais lento.
- Metáfora: VENCIDO é o cheque que voltou (furaram a palavra); EM EXECUÇÃO é o oficial de justiça na porta (você foi buscar à força).

### 3. DEPOSITADO EM JUÍZO — garantido porém travado
Valor certo, data previsível, risco ~zero (o devedor já pagou, o dinheiro está numa conta do governo), mas **não descontável** porque legalmente travado. Metáfora: cofre com cronômetro travado num aniversário — o dinheiro mais SEGURO da carteira e o mais INACESSÍVEL. Simetria com PROJETADO: ambos ficam fora do fluxo corrente, mas por motivos opostos (PROJETADO é um "talvez" sem garantia; DEPOSITADO é garantia sem acesso).
- **Aplica-se às DUAS linhas**: cota do cliente-menor (art. 1.691 CC — saque só na maioridade, e ainda exige alvará judicial) E honorário que o juiz só libera ao final.
- **Bônus de gestão**: como a liberação do menor é o aniversário de 18, dá para montar cronograma de liberações ano a ano (previsão de caixa de altíssima confiança).
- **No relatório FIDC**: linha separada "valor garantido, liberação datada, não antecipável" — nunca somada ao A RECEBER.

### 4. PROJETADO NUNCA vence
Sem promessa, não há o que quebrar. "Estimado vencido" é oximoro. PROJETADO só sai para CONDENAÇÃO/A RECEBER (ganhou decisão) ou INDEFERIDO (perdeu).

## Fronteiras já decididas pelo Raym (não reabrir sem ele pedir)

- **Execução recém-aberta, ainda sem penhora/bloqueio** → já é **EM EXECUÇÃO** (o gatilho é o ato de ir buscar à força, não o dinheiro aparecer). Sai de CONDENAÇÃO no protocolo da execução.
- **Penhora parcial** (bloqueou R$50k de R$200k) → **parte a parcela**: os R$50k com bloqueio sobem para A RECEBER (data provável de liberação); os R$150k restantes seguem EM EXECUÇÃO.
- **Acordo homologado = 100% COM trânsito em julgado.** As partes renunciam ao prazo recursal / há aquiescência (art. 1.000 CPC). Ninguém recorre do próprio acordo. Portanto o filtro de risco volta a ser **binário** (COM/SEM trânsito), sem balde do meio.

## DIMENSÕES ORTOGONAIS — NÃO viram estágio, viram FILTRO

Cortam ATRAVÉS dos estágios → são filtros/colunas, nunca termos da régua. Regra: se o atributo poluiria mais de um estágio, é filtro. Metáfora: a régua é a prateleira (altura = certeza); as dimensões são etiquetas na caixa.

| Dimensão | Valores | Como se determina | Observação |
|---|---|---|---|
| **Origem do valor** | ACORDO / CONDENAÇÃO* | há `jm_acordos`? senão vem de sentença/liquidação | *"condenação" aqui é ORIGEM (juiz fixou vs partes acordaram), não o ESTÁGIO. Dimensão de ouro: acordo fecha ~14 meses vs ~38 judicial |
| **Modalidade** | À VISTA / PARCELADO | **derivada, nunca digitada**: 1 parcela = à vista; 2+ = parcelado | `count(parcelas)` nunca mente |
| **Origem do processo** | INTERNO / EXTERNO | já em `jm_processos` | INTERNO = escritório advoga; EXTERNO = só jurimetria |
| **Trânsito** | COM / SEM trânsito | atributo do processo (acordo homologado = sempre COM) | risco de reforma, não estágio |
| **Cessão do honorário** | CESSÍVEL? / CEDIDO? | duas perguntas distintas (ver abaixo) | por cliente, não por processo |

## Cessão do honorário — duas perguntas distintas, por cliente

Não confundir "pode ser vendido" com "foi vendido":
1. **CESSÍVEL?** (elegibilidade — regra automática). Um honorário é cessível se passa em TODAS as travas:
   - não é de cliente **menor** (crédito de menor é inalienável — art. 1.691 CC);
   - não está sujeito a **RPV/precatório** (IRDR 34 TRF4, 26/11/2025, proíbe cessão de crédito previdenciário sob requisição de pagamento);
   - não está **DEPOSITADO EM JUÍZO** (travado);
   - está num estágio que permite (tipicamente A RECEBER).
2. **CEDIDO?** (decisão do Raym — flag manual). A cessão é **opcional e por cliente**. Pode ser CESSÍVEL e o Raym segurar (quer o fluxo inteiro), ou CESSÍVEL e cedido.

**Só honorário com `cedido = sim` soma no ativo securitizado do FIDC.** Cessível-não-cedido fica num limbo "disponível para ceder", fora do ativo. Se o banco tratar "cessível" como "cedido", o relatório infla a carteira.

## Honorário sucumbencial — rateio por cliente

Mesmo quando o juiz fixa o sucumbencial "global" para o processo, ele é **rateado entre os clientes proporcionalmente ao resultado (cota de indenização) de cada um** — não dividido igual, e nunca deixado como linha órfã "do processo". Metáfora: é a conta de luz do prédio — chega num boleto só, mas rateia-se por apartamento (fração ideal), senão na hora de vender uma unidade ninguém sabe quanto vai junto.
- **Auditoria obrigatória**: guardar o **valor global original** fixado pelo juiz numa coluna separada. O rateio proporcional é o default automático; a soma das frações deve bater com o global. Se o juiz fixou sucumbencial em R$ fixo (causa de valor inestimável), o rateio proporcional é uma escolha de conveniência — a coluna de auditoria garante que a conveniência não apague o número real.

## Regras de negócio críticas

### O estágio é da PARCELA (dentro do par processo×cliente), nunca do acordo inteiro
Um acordo de 10 parcelas está vivo em vários estágios: pode ser 3 PAGO + 1 VENCIDO + 6 A RECEBER. Carimbar o acordo inteiro com um estágio só é mentir. O processo/cliente mostra a **composição** (barra "60% realizado").

### O tempo reclassifica sozinho — não se digita estágio
Estágio é consequência de perguntas que o sistema faz toda madrugada: tem decisão? a data passou? está travado? O "acordo a vencer" de hoje (A RECEBER) vira VENCIDO amanhã sozinho se não pagarem. Metáfora do leite: no prazo (A RECEBER), azedou (VENCIDO), foi reclamar (EM EXECUÇÃO) — mesmo litro, muda a validade contra hoje.

### No relatório FIDC, A RECEBER abre por trânsito
Tela do dia a dia: régua limpa, trânsito é toggle. Relatório Tercon/Limine: A RECEBER aparece em duas linhas (COM/SEM trânsito) — valem dinheiros diferentes (sem-trânsito tem risco de reforma). Não é termo novo, é o mesmo estágio com filtro pré-aplicado e visível.

## Ordem de leitura (decrescente de certeza do caixa)

**PROJETADO → CONDENAÇÃO → A RECEBER → VENCIDO / EM EXECUÇÃO → DEPOSITADO EM JUÍZO → PAGO** (INDEFERIDO = saída lateral)

## Como classificar — passo a passo (por par processo × cliente, e por recebível)

Para CADA cliente, classifique separadamente a cota do cliente e o honorário:
1. **Tem decisão (acordo ou sentença)?** Não → **PROJETADO**.
2. **Já entrou na conta?** Sim → **PAGO**.
3. **Está depositado em juízo mas travado** (menor até 18, ou honorário liberável só ao final)? Sim → **DEPOSITADO EM JUÍZO**.
4. **Tem data de pagamento concreta?** Não (só o valor fixado) → **CONDENAÇÃO**.
5. **A data já passou?** Não → **A RECEBER**.
6. **A data passou** — houve promessa voluntária (acordo/condenação aceita)? Sim, não pagaram → **VENCIDO**. Está sendo forçado por penhora, ou execução recém-aberta → **EM EXECUÇÃO**.

Depois anexe as dimensões como filtros: origem do valor, modalidade (derivada), interno/externo, trânsito, cessível?/cedido? (só honorário).

## Vínculo com as views jm_ e regra de segurança

- `vw_jm_fluxo_mensal`, `vw_jm_kpi_linha_tempo`: evoluir para a granularidade `(processo × cliente)` e para a régua de 7, separando cota-cliente vs honorário. De-para na camada de apresentação primeiro.
- **Modo Leopardo / regra dura**: nenhuma migração física (ALTER TYPE / UPDATE em massa / mudança de granularidade) sem (a) aval explícito do Raym, (b) a **conciliação dos números-âncora fechar** — a soma em `(processo × cliente)` tem de bater com o estoque atualizado (~R$41,7M) por processo; divergência = dupla contagem ou cliente órfão, e (c) **fora do horário do cron `esc_colher`**. Migrações são aditivas (colunas novas), nunca destrutivas sem conciliação.

## Planilha-fonte — sempre deixar acessível (regra dura)

Toda vez que eu puxar dado de planilha (pra classificar recebível, montar
relatório FIDC, conferir número-âncora, etc.), a planilha correspondente TEM
de ficar acessível ao Raym na mesma resposta:
1. **Informar o link do Drive** da planilha de onde o dado saiu (tabela abaixo).
2. **Conferir o dado na fonte** via Google Drive antes de afirmar — não citar
   número de planilha de memória. Se não li a fonte nesta sessão, dizer isso.
3. Se o dado veio de view `jm_` (derivada da planilha), citar as DUAS coisas:
   a view E a planilha-mãe.

Planilhas-fonte da carteira (conferir no Drive antes de usar):

| Planilha | ID / Link | Papel |
|---|---|---|
| **Jurimetria/indenização** | `1WQCQdYwvBBvIfS2iiU1iiFiCZ38j2zHDTmpy1AXxFMM` — https://docs.google.com/spreadsheets/d/1WQCQdYwvBBvIfS2iiU1iiFiCZ38j2zHDTmpy1AXxFMM/edit | Fonte da carteira FIDC: condenação, cota-cliente, honorário contratual/sucumbencial, cessão. Destino do "Exportar → Google Sheets" do Setor Processual. |

Quando puxar de outra planilha (marketing, audiências, triagem), aplicar a
mesma regra: informar o link correspondente do Drive na resposta.

## Campos novos previstos para a implementação no banco (sessão dedicada, não agora)

Aditivos, no nível `(processo × cliente)`: `cota_cliente_liquida`, `honorario_contratual`, `honorario_sucumbencial_rateado`, `honorario_sucumbencial_global_auditoria`, `honorario_cessivel` (derivado das travas), `honorario_cedido` (flag manual), e o estado `DEPOSITADO_EM_JUIZO` no enum de estágio + `data_liberacao` (aniversário de 18 ou "ao final").

## Perguntas em aberto (confirmar com o Raym antes de cravar no código)

- Praxe do honorário do menor **varia por juiz** (Raym confirmou 3 praxes): (1) libera o honorário logo por alvará separado; (2) só libera ao final (→ honorário fica DEPOSITADO); (3) não deixa descontar nada da parte do menor. **Isso se lê no alvará/decisão caso a caso — nunca presumir pela média.** Precisa de um campo que registre qual praxe aquele juízo aplicou.
