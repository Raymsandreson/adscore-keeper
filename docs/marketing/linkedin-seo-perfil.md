# LinkedIn — SEO de perfil e plano de conteúdo (Raymsandreson Prudêncio)

**Objetivo definido:** captar clientes para o escritório. Não é busca de vaga, não é
posicionamento para fundo/investidor.

**Data:** 20/08/2026
**Base de evidência:** print do perfil (20/08/2026) + áreas reais de atuação extraídas do
repositório (`src/lib/funnelSheetConfig.ts`, `src/lib/trabalhistaAcolhedores.ts`).

---

## 0. Áreas de atuação (fonte da verdade)

Extraídas do próprio sistema, não de suposição:

| Área | Evidência no repo |
|---|---|
| BPC/LOAS (idoso e pessoa com deficiência, incl. autismo) | `funnelSheetConfig.ts:37` — regex `/bpc\|autis/`, funil com planilha Meta Ads |
| Auxílio-Acidente (previdenciário) | `funnelSheetConfig.ts:28-35` — funil próprio com planilha |
| Acidente de Trabalho (trabalhista) | `trabalhistaAcolhedores.ts:1` — board Trabalhista |

Frequência dos termos no repositório: `inss` 743×, `bpc` 420×, `trabalhista` 196×,
`loas` 54×, `acidente de trabalho` 48×.

Praça: **Teresina — Piauí**.

---

## 1. Diagnóstico

Números do próprio painel "Análise" do perfil, em 20/08/2026:

- **0 ocorrência em resultados de pesquisa**
- **0 impressão da publicação** (últimos 7 dias)
- 16 visualizações do perfil
- 151 conexões

Não é um problema de "pouco alcance". É um perfil que, para efeito de busca,
**não existe**. Causas, em ordem de gravidade:

### 1.1 — `#OPENTOWORK` + card "Buscando emprego" (crítico, contradiz o objetivo)

A foto tem a moldura verde `#OPENTOWORK` e o perfil exibe o card
*"Buscando emprego · Todos no LinkedIn — Teresina, PI | Presencial"*.

Com a opção "Todos no LinkedIn", **isso é público**. Um cliente que chega para
contratar um advogado vê, antes de qualquer outra coisa, um profissional anunciando
que procura emprego — enquanto o subtítulo diz "Sócio fundador". A contradição
destrói a credibilidade na primeira dobra da página e nenhuma otimização de texto
compensa isso.

**É o primeiro item a resolver, e sozinho já muda a leitura do perfil.**

### 1.2 — Headline sem uma única palavra-chave (causa direta das 0 ocorrências)

Headline atual: `Sócio fundador Raymsandreson Prudêncio Advogados`

Dois problemas:

1. A headline é o campo de **maior peso** no ranqueamento da busca interna do LinkedIn
   e é o que compõe o `<title>` da página no Google. A atual não contém nenhum termo
   que uma pessoa digitaria: nem "advogado", nem "INSS", nem "BPC", nem "Teresina".
2. Ela gasta os caracteres repetindo o nome — que já aparece logo acima, duas vezes
   (nome do perfil + empresa vinculada).

Ninguém busca por "Raymsandreson Prudêncio" a não ser quem já conhece. As 0 ocorrências
em pesquisa são consequência aritmética disso.

### 1.3 — URL pública com acento e sufixo aleatório

Atual: `www.linkedin.com/in/raymsandreson-prudêncio-0a6684a0`

- O acento vira `prud%C3%AAncio` quando a URL é copiada, compartilhada ou indexada.
  Fica ilegível em qualquer lugar onde o link apareça.
- O sufixo `0a6684a0` é o hash automático de quem nunca personalizou a URL — sinal de
  perfil abandonado, e ruído para o buscador.

### 1.4 — Capa (banner) vazia

O maior espaço visual da página é um retângulo cinza. É onde deveria estar, legível
em 2 segundos: o que o escritório faz, para quem, e como falar com ele.

### 1.5 — Perfil sem atividade

0 impressões em 7 dias. O LinkedIn distribui perfis que produzem; um perfil mudo não
entra em nenhum feed, e o Google tem pouca coisa nova para reindexar.

### 1.6 — 151 conexões

Abaixo de 500 a rede é rasa: buscas por "advogado previdenciário Teresina" dentro do
LinkedIn priorizam conexões de 1º/2º grau, e com uma rede pequena o perfil fica fora
do alcance da maior parte das buscas locais.

### 1.7 — Não verificado nesta análise

Sendo explícito sobre o que **não** dá para afirmar a partir do print, porque ele corta
a página:

- **Seção "Sobre"** — não aparece no print (o que se vê depois do topo é
  "Sugestões para você" e "Análise"). Não sei se está vazia, curta ou apenas fora do
  enquadramento. O "Sobre" é indexado pelo Google e pesa na busca interna, então
  precisa ser conferido.
- **Toggle de indexação em buscadores** — em Configurações → Visibilidade →
  "Editar perfil público", existe a chave que autoriza o Google a indexar o perfil.
  Se estiver desligada, **nada neste documento produz resultado no Google**. Conferir
  antes de tudo.
- **Seções Experiência, Formação, Competências e Recomendações** — mesma coisa, não
  estão no print.

---

## 2. Restrição profissional — publicidade na advocacia

Todo o texto proposto adiante foi escrito no registro **informativo e sóbrio**, sem:

- promessa ou garantia de resultado ("ganhe seu benefício", "aprovação garantida");
- superlativos ("melhor advogado", "nº 1 do Piauí");
- menção a preço, honorário, desconto ou "consulta grátis";
- convocação mercantil ao litígio;
- qualquer dado que identifique cliente ou processo.

O marco regulador é o **Provimento 205/2021 do CFOAB**. **Não conferi o texto do
Provimento nesta sessão** — não vou citar artigo de cabeça. Antes de publicar, vale
uma leitura direta da norma, especialmente sobre dois pontos: (a) a obrigatoriedade de
identificar nome e número de inscrição na OAB no material, e (b) as regras de
impulsionamento pago de conteúdo jurídico. Como o escritório já opera captação por
Meta Ads (`funnelSheetConfig.ts`), a posição sobre o item (b) provavelmente já existe
internamente — mas o LinkedIn e o Meta seguem a mesma norma.

O placeholder `OAB/PI nº _____` aparece nos textos e precisa ser preenchido.

---

## 3. Palavras-chave-alvo

O que uma pessoa realmente digita — no Google e na busca do LinkedIn:

**Primárias (têm que estar na headline e no Sobre):**
- advogado previdenciário Teresina
- advogado BPC LOAS
- advogado INSS Teresina
- advogado acidente de trabalho Teresina

**Secundárias (Sobre, Experiência, Competências, Serviços):**
- BPC LOAS autismo
- benefício negado INSS
- auxílio-acidente
- perícia do INSS
- advogado previdenciário Piauí
- LOAS deficiente / LOAS idoso
- revisão de benefício

Cada termo precisa aparecer em texto corrido natural. Empilhar palavra-chave separada
por barra derruba a leitura e não ajuda o ranqueamento.

---

## 4. Textos prontos

### 4.1 — Headline (máx. 220 caracteres)

**Opção A — recomendada** (busca local + as três áreas):

```
Advogado Previdenciário em Teresina (PI) | BPC/LOAS, Auxílio-Acidente e Acidente de Trabalho | Sócio fundador — Raymsandreson Prudêncio Advogados
```

**Opção B** (mais direta ao problema do cliente):

```
Advogado Previdenciário e Trabalhista em Teresina (PI) | BPC/LOAS, benefícios do INSS e acidente de trabalho | Raymsandreson Prudêncio Advogados
```

**Opção C** (se quiser destacar o nicho de deficiência/autismo):

```
Advogado Previdenciário em Teresina (PI) | BPC/LOAS para idosos e pessoas com deficiência | Auxílio-Acidente e Acidente de Trabalho | OAB/PI
```

Todas começam com "Advogado" + área + cidade, que é exatamente a ordem em que a busca
é digitada.

### 4.2 — Sobre (máx. 2.600 caracteres)

Os **três primeiros parágrafos** são o que aparece antes do "…ver mais" e o que o
Google costuma exibir como descrição. O peso está ali.

```
Atuo com Direito Previdenciário e Direito do Trabalho em Teresina (PI), à frente do
escritório Raymsandreson Prudêncio Advogados.

A maior parte do que chega até nós começa do mesmo jeito: um benefício negado pelo
INSS, uma perícia que não reconheceu a incapacidade, um acidente de trabalho tratado
como se não tivesse acontecido. São situações em que a pessoa está sem renda e sem
saber a quem perguntar.

Nossas frentes de atuação:

• BPC/LOAS — benefício assistencial para idosos a partir de 65 anos e para pessoas com
deficiência, incluindo casos de Transtorno do Espectro Autista, tanto no requerimento
administrativo quanto na via judicial após o indeferimento.

• Auxílio-Acidente e benefícios por incapacidade — auxílio por incapacidade temporária,
aposentadoria por incapacidade permanente e revisão de benefícios já concedidos.

• Acidente de Trabalho — responsabilidade do empregador, estabilidade acidentária e
verbas decorrentes do acidente e da doença ocupacional.

Cada caso é analisado individualmente antes de qualquer orientação: documentação
médica, histórico de contribuições e o que consta no processo administrativo do INSS.
Não existe resposta padrão, e não trabalho com previsão de resultado — trabalho com
leitura honesta do que os documentos sustentam.

O escritório mantém estrutura própria de acompanhamento processual, com atualização
de andamento e canal direto de contato, para que o cliente não precise ligar
perguntando "e o meu processo?".

Atendimento em Teresina e em todo o Piauí.

Raymsandreson Prudêncio — OAB/PI nº _____
Contato: [WhatsApp / e-mail]

Este perfil tem finalidade informativa, nos termos do Código de Ética e Disciplina da
OAB e do Provimento 205/2021 do CFOAB.
```

> Trocar `_____` pelo número da OAB e `[WhatsApp / e-mail]` pelo canal real antes de
> publicar. Sem a OAB, o texto não deve ir ao ar.

### 4.3 — URL pública

Trocar para:

```
linkedin.com/in/raymsandreson-prudencio-advogado
```

Alternativa, se estiver disponível e preferir mais curta:
`linkedin.com/in/raymsandreson-prudencio`

**Aviso:** o LinkedIn **não redireciona** a URL antiga — links já publicados apontando
para a URL velha quebram. No estado atual (16 visualizações, 0 ocorrências em busca)
praticamente não há links externos a perder, então **o custo de mudar é hoje o menor
possível e só cresce daqui pra frente**.

### 4.4 — Experiência

O título do cargo é indexado com peso alto, quase tanto quanto a headline. Hoje ele
provavelmente diz só "Sócio fundador", que não é um termo de busca.

**Título do cargo:**
```
Sócio fundador | Advogado Previdenciário e Trabalhista
```

**Descrição do cargo:**
```
Escritório de advocacia em Teresina (PI) dedicado a Direito Previdenciário e Direito
do Trabalho.

Atuação em BPC/LOAS (idoso e pessoa com deficiência, incluindo TEA), auxílio-acidente,
benefícios por incapacidade e revisões junto ao INSS, além de acidente de trabalho e
doença ocupacional na esfera trabalhista.

Responsável pela coordenação técnica das equipes, pela estruturação do fluxo de
atendimento e acompanhamento processual e pela definição da tese em casos de maior
complexidade.
```

### 4.5 — Competências (Skills)

O LinkedIn permite até 50, e **fixa as 3 primeiras** no alto da seção. Elas pesam na
busca. Ordem sugerida:

1. Direito Previdenciário
2. BPC/LOAS
3. Direito do Trabalho

Depois: INSS · Benefício por Incapacidade · Auxílio-Acidente · Acidente de Trabalho ·
Aposentadoria · Direito Processual Civil · Perícia Médica Judicial · Advocacia ·
Contencioso Cível · Gestão de Escritório de Advocacia · Doença Ocupacional ·
Direito da Pessoa com Deficiência

Depois de cadastrar, pedir **validação (endorsement)** dessas competências a colegas —
competência validada ranqueia acima de competência apenas declarada.

### 4.6 — Seção "Fornecer serviços"

Subutilizada e importante: gera uma **página de serviços própria e indexável**, coloca
o perfil na busca de serviços do LinkedIn e habilita o selo "Fornecer serviços" no topo.

Cadastrar em Direito → e escrever:

```
Orientação e atuação em Direito Previdenciário e Direito do Trabalho:

• BPC/LOAS — idoso e pessoa com deficiência (incluindo TEA)
• Benefícios por incapacidade e auxílio-acidente
• Revisão de benefícios do INSS
• Acidente de trabalho e doença ocupacional

Atendimento em Teresina (PI) e em todo o Piauí, presencial e remoto.
```

### 4.7 — Capa, contato e botão

- **Capa:** substituir o cinza. Precisa conter, legível no celular: nome do escritório,
  as três áreas, cidade, e o contato. Sem promessa de resultado, sem preço.
- **Dados de contato:** preencher WhatsApp e site. O funil do escritório é WhatsApp —
  não faz sentido o número não estar ali.
- **Botão personalizado:** o perfil ainda mostra "Adicionar botão personalizado" sem uso.
  Configurar como **"Visitar site"** (site do escritório) ou **"Fale comigo"**.
- **Em destaque (Featured):** fixar 2–3 itens — site do escritório e as publicações de
  melhor desempenho, conforme forem saindo.

---

## 5. Ordem de execução

A ordem importa. Item 1 antes de tudo; item 2 é o que destrava as ocorrências em busca.

| # | Ação | Onde | Esforço |
|---|---|---|---|
| 1 | **Remover `#OPENTOWORK` e o card "Buscando emprego"** | Perfil → Disponível para → excluir | 2 min |
| 2 | **Confirmar indexação em buscadores ligada** | Config. → Visibilidade → Editar perfil público | 2 min |
| 3 | Nova headline (§4.1) | Editar perfil | 5 min |
| 4 | Nova URL pública (§4.3) | Editar perfil público e URL | 3 min |
| 5 | Sobre (§4.2) — **conferir antes se está vazio** | Editar perfil | 15 min |
| 6 | Título e descrição da Experiência (§4.4) | Editar perfil | 10 min |
| 7 | Competências + pedir validações (§4.5) | Editar perfil | 15 min |
| 8 | Seção "Fornecer serviços" (§4.6) | Perfil → Adicionar seção | 10 min |
| 9 | Capa, contato, botão personalizado (§4.7) | Editar perfil | 30 min |
| 10 | Conexões: subir de 151 para 500+ | ver §6 | contínuo |
| 11 | Rotina de publicação | ver §7 | contínuo |

Itens 1 a 9 somam menos de duas horas e são a diferença entre um perfil invisível e um
perfil que aparece.

**Prazo realista:** a busca interna do LinkedIn reflete as mudanças em horas. O Google
leva de **alguns dias a algumas semanas** para reindexar — e a mudança de URL (item 4)
reinicia esse relógio. Não é instantâneo, e não adianta reavaliar em 48h.

---

## 6. Rede (151 → 500+)

Abaixo de 500 conexões o perfil fica fora do alcance da maior parte das buscas locais,
que priorizam 1º e 2º grau. Sem comprar lista e sem disparo automático:

- Advogados e servidores do foro de Teresina e do TRF1/TRT-22
- Médicos peritos, ortopedistas, psiquiatras, neuropediatras (fonte natural de
  encaminhamento em BPC/TEA e incapacidade)
- Assistentes sociais e CRAS/CREAS (porta de entrada do BPC/LOAS)
- Sindicatos e técnicos de segurança do trabalho (acidente de trabalho)
- Contadores e RHs de empresas locais
- Associações de pais de autistas e entidades de pessoas com deficiência

Ritmo: 10–15 convites por dia, sempre com nota personalizada de uma linha. Convite em
massa sem nota derruba a taxa de aceite e pode gerar restrição na conta.

---

## 7. Plano de conteúdo

0 impressões em 7 dias. Perfil sem publicação não é distribuído — e o conteúdo é
também o que dá ao Google material novo para indexar.

**Frequência:** 3 posts por semana (ter/qui/sáb). Constância vale mais que volume.

**Formato:** texto puro tem o melhor alcance orgânico no LinkedIn. Carrossel (PDF) para
conteúdo em etapas. Vídeo curto ocasional. Link externo no corpo do post reduz alcance
— quando precisar, põe o link no primeiro comentário.

**Estrutura de cada post:** primeira linha é uma frase completa que faz sentido sozinha
(é só ela que aparece antes do "ver mais"). 800–1.300 caracteres. Uma pergunta ao final.
3 a 5 hashtags, no fim.

### Pilares

| Pilar | Peso | O que é |
|---|---|---|
| **Dúvida do cliente** | 40% | A pergunta que chega toda semana, respondida em linguagem simples |
| **Regra e decisão** | 25% | Mudança de regra do INSS, entendimento consolidado dos tribunais |
| **Caso na prática** | 20% | Situação-tipo, **totalmente anonimizada** |
| **Bastidor e gestão** | 10% | Como o escritório organiza atendimento e acompanhamento — atrai colega e parceiro |
| **Institucional** | 5% | Equipe, participações, marcos |

### 12 pautas para as 4 primeiras semanas

1. "O INSS negou meu BPC. Acabou?" — o que significa o indeferimento e o que vem depois
2. BPC/LOAS: quem tem direito, em critérios objetivos (idade, renda familiar, deficiência)
3. Autismo e BPC/LOAS: o que a perícia efetivamente avalia
4. Os documentos que faltam na maioria dos pedidos de BPC — e por que derrubam o caso
5. Auxílio-acidente x auxílio por incapacidade: a diferença que quase todo mundo confunde
6. Perícia do INSS: o que levar, o que dizer, o que não fazer
7. Acidente de trabalho: os prazos que o trabalhador perde por não saber que existem
8. CAT não emitida pela empresa — o que o trabalhador pode fazer
9. Estabilidade após acidente de trabalho: quanto tempo e a partir de quando
10. Doença ocupacional: por que LER/DORT costuma ser tratada como doença comum
11. Por que o escritório acompanha o andamento processual em vez de esperar o cliente ligar
12. Quanto tempo demora um processo previdenciário — resposta honesta, com faixas

### Regras invioláveis de publicação

Ligadas diretamente ao sigilo profissional e à LGPD:

- **Nunca** nome de cliente, CPF, RG, número de processo, número de benefício, print de
  conversa de WhatsApp ou foto de documento — nem com tarja.
- Caso na prática só entra **descaracterizado**: sem cidade específica, sem idade exata,
  sem data, sem combinação de detalhes que permita reconhecer a pessoa.
- Nunca prometer resultado, citar valor recebido por cliente ou publicar "mais uma
  vitória" com print de decisão.
- Nunca comentar processo em andamento do escritório.

### Métricas — revisar todo dia 1º

Painel "Análise" do perfil:

| Indicador | Hoje (20/08/2026) | 30 dias | 90 dias |
|---|---|---|---|
| Ocorrências em resultados de pesquisa | 0 | 50+ | 300+ |
| Visualizações do perfil | 16 | 80+ | 300+ |
| Impressões de publicação (7d) | 0 | 1.500+ | 6.000+ |
| Conexões | 151 | 300+ | 600+ |

Se em 30 dias as ocorrências em pesquisa continuarem em 0 com os itens 1–9 aplicados,
o problema é a chave de indexação (item 2) ou a visibilidade do perfil público — não o
texto. Verificar isso antes de reescrever qualquer coisa.

---

## 8. O que este documento não cobre

- Site do escritório e SEO fora do LinkedIn (Google Meu Negócio, conteúdo próprio) —
  é onde está o volume real de busca por "advogado INSS Teresina", e o LinkedIn sozinho
  não substitui.
- Página da empresa no LinkedIn (`Raymsandreson Prudêncio Advogados`) — o print mostra
  que ela existe e está vinculada, mas não foi analisada.
- Campanhas pagas.
- Conferência do texto do Provimento 205/2021 (ver §2).
