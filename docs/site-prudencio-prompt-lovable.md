# Prompt inicial — Lovable · Site do escritório Prudêncio Advogados

Fontes usadas: repositório WhatsJUD (`docs/sistema/`, `src/pages/LandingPage.tsx`, `src/index.css`) e o site
**familiaabraci.com.br** (estrutura de serviços, contatos, sede, taxonomia de casos).

> Cole o bloco entre `=== INÍCIO DO PROMPT ===` e `=== FIM DO PROMPT ===` como **primeira mensagem** num projeto novo do Lovable.
> `[CONFIRMAR]` = dado que ainda não existe em nenhuma fonte; trocar antes de publicar.

---

=== INÍCIO DO PROMPT ===

Crie o **site institucional do escritório Prudêncio Advogados**, em **português do Brasil**: uma landing page longa
(`/`) mais **páginas dedicadas por tipo de caso** e páginas legais. Stack: **Vite + React + TypeScript + Tailwind +
shadcn/ui + react-router-dom + lucide-react**.

## 1. Quem é o cliente

**Prudêncio Advogados** — banca sediada em **Teresina/PI**, liderada por **Dr. Raymsandreson de Morais Prudêncio**,
com atuação nacional. Trabalha com direito previdenciário, acidente de trabalho e reparação, e direito do consumidor
securitário. Atende principalmente **famílias de trabalhadores vítimas de acidente de trabalho** (inclusive com óbito),
**segurados do INSS** e **pessoas com deficiência**.

O grupo tem outras duas frentes, que aparecem no site como **contexto institucional, não como produto**:
- **ABRACI** — associação que faz acolhimento, apoio psicológico e assessoria documental às famílias.
- **WhatsJUD** — plataforma própria de gestão jurídica com IA, desenvolvida internamente, registrada no INPI.

**O eixo do site é a advocacia e os casos que o escritório aceita.** ABRACI e WhatsJUD são seções secundárias, curtas,
no fim da página. Não transforme o site num site de SaaS nem num site de associação.

## 2. Restrição inegociável: publicidade advocatícia (OAB)

Site de sociedade de advogados. Vale o **Código de Ética da OAB e o Provimento 205/2021 do CFOAB**. Aplique na copy inteira:

**Proibido**
- Prometer, garantir ou insinuar resultado ("consiga seu benefício", "aprovação garantida", "você tem direito").
- Superlativo e autoproclamação ("o melhor", "líder", "referência nacional", "nº 1", "especialista" como título).
- **Depoimento de cliente, avaliação em estrelas, nota do Google, "case de sucesso"** — o site não tem seção de
  depoimentos, em nenhuma forma. Os depoimentos existentes no site da ABRACI são da associação e não vêm para cá.
- Valor de honorário, "consulta grátis", "sem custo inicial", percentual de êxito.
- Contador regressivo, "últimas vagas", qualquer urgência artificial.
- Imagem de martelo de juiz, balança dourada, pilha de dinheiro, aperto de mão genérico de banco de imagens.

**Obrigatório**
- Tom informativo e sóbrio. O site **explica direitos e procedimentos**; não vende.
- Rodapé com **RAYMSANDRESON PRUDENCIO SOCIEDADE DE ADVOGADOS · CNPJ 32.965.023/0001-27 · OAB/PI nº [CONFIRMAR — inscrição da sociedade]**.
- Página de Política de Privacidade com base legal LGPD.
- CTA sempre como convite ao contato: **"Falar com a equipe"**, **"Tirar uma dúvida"**, **"Enviar mensagem"**.
- Número só entra se for verificável. **Não invente estatística.** Sem dado, use texto qualitativo e deixe `[CONFIRMAR]` visível.

**Nuance de redação importante**: o site da ABRACI usa deliberadamente "orientação documental", "suporte administrativo",
"organização de documentos" — porque associação não presta serviço jurídico. **Aqui é o contrário**: o escritório pode e
deve dizer que atua, requer, recorre e ingressa com ação. Não copie a linguagem cautelosa da ABRACI para cá — mas
também não prometa desfecho.

## 3. Identidade visual

Design system em CSS variables HSL no `index.css` + `tailwind.config.ts`. Nenhuma cor hardcoded em componente.

```
--primary:            153 100% 33%   /* verde institucional do grupo */
--foreground:           0 0%  9%
--background:           0 0% 100%
--muted:                0 0% 96%
--muted-foreground:     0 0% 45%
--border:               0 0% 90%
--radius: 0.75rem
```

- **Tipografia**: `Inter` (Google Fonts, `display=swap`). Títulos `font-bold tracking-tight`; corpo `text-muted-foreground leading-relaxed`.
- **Estética**: corporativa e limpa, muito espaço em branco, seções alternando `bg-background` / `bg-muted/30`, cartões
  `border border-border/60 rounded-2xl` com sombra sutil. Sem gradiente forte, sem glassmorphism, sem neon, sem emoji na interface.
- **Dark mode** completo por classe, tokens espelhados.
- Ícones `lucide-react` de traço fino, dentro de quadrado `bg-primary/10 rounded-xl`, ícone em `text-primary`.
- Animação discreta: fade-in + `translate-y` de 8px ao entrar na viewport, 300–400ms. Nada além disso.
- **Tom das imagens**: pessoas reais, luz natural, contexto de acolhimento e trabalho. [CONFIRMAR: fotos do escritório e da equipe]

## 4. Landing page `/` — seção a seção

### Navbar
Sticky, `backdrop-blur`, borda inferior sutil. Logo textual "Prudêncio **Advogados**" (peso leve + bold).
Links: Atuação · Como trabalhamos · O escritório · ABRACI · Perguntas frequentes · Contato.
Botão outline "Falar com a equipe" → WhatsApp.

### 1. Hero
- H1: **"Advocacia para quem sofreu um acidente de trabalho ou precisa de um benefício do INSS."**
- Subtítulo: "Atuamos na via administrativa e judicial em acidente de trabalho, benefícios previdenciários, BPC/LOAS e
  seguros. Do primeiro atendimento ao acompanhamento de cada movimentação do processo."
- Botões: primário "Falar com a equipe" · ghost "Ver áreas de atuação" (scroll suave).
- Imagem institucional à direita (empilha no mobile).
- Sem badge de superlativo, sem número inventado.

### 2. Faixa de contexto (fina, `bg-muted/30`)
Quatro itens **factuais**, em texto curto com ícone:
"Justiça Federal, Justiça do Trabalho e INSS administrativo" · "Sede em Teresina/PI, atendimento em todo o Brasil" ·
"Acompanhamento processual com tecnologia própria" · "Apoio da ABRACI às famílias atendidas".

### 3. Áreas de atuação — **a seção principal do site**
Cinco blocos. Cada bloco tem título, uma linha de contexto e uma lista de tipos de caso; **cada tipo de caso é um link
para a sua própria página** (rotas na seção 5). Layout: acordeão em mobile, grid de cartões em desktop.

**Acidente de trabalho e reparação** (`HardHat`)
Atuação para o trabalhador acidentado e para a família em caso de óbito.
- Acidente de trabalho com óbito — direitos dos dependentes
- Acidente de trabalho com sequela ou incapacidade
- Doença ocupacional e nexo com a atividade
- Estabilidade acidentária e reintegração
- Reparação civil por danos morais, materiais e estéticos contra o empregador
- Emissão e retificação de CAT; apuração do acidente junto aos órgãos competentes
- Acidente com motorista e entregador de aplicativo (Uber, 99, iFood, Rappi, Loggi)

**Benefícios por incapacidade — INSS** (`Stethoscope`)
- Auxílio por incapacidade temporária (auxílio-doença)
- Auxílio-doença acidentário (espécie 91)
- Auxílio-acidente
- Aposentadoria por incapacidade permanente
- Recurso administrativo e ação judicial após indeferimento ou cessação

**Aposentadorias** (`Clock`)
- Aposentadoria por idade
- Aposentadoria por tempo de contribuição
- Aposentadoria rural — trabalhador rural e pescador artesanal
- Aposentadoria especial — exposição a agente nocivo (frentista, eletricista, metalúrgico, profissional de saúde, radiologista)
- Revisão de benefício já concedido

**BPC / LOAS e direitos da pessoa com deficiência** (`HeartHandshake`)
- BPC/LOAS para idoso e para pessoa com deficiência
- BPC para Transtorno do Espectro Autista (TEA)
- BPC para TDAH
- BPC para esquizofrenia e transtornos psicóticos
- BPC para depressão grave e incapacitante
- BPC para doenças ortopédicas limitantes
- Acompanhamento da perícia médica e da avaliação social

**Pensão, maternidade e seguros** (`Shield`)
- Pensão por morte
- Salário-maternidade — nascimento, adoção e guarda judicial
- Seguro de vida, seguro veicular, residencial e saúde: sinistro negado ou pago a menor
- Seguro das plataformas de aplicativo em acidente durante o trabalho

### 4. Como trabalhamos — 4 passos (01→04)
1. **Escuta** — entendemos o que aconteceu e quais documentos existem.
2. **Análise de viabilidade** — avaliamos o direito e explicamos os cenários possíveis, **inclusive quando não há caso**.
3. **Condução** — atuamos na via administrativa ou judicial, conforme a estratégia combinada com você.
4. **Acompanhamento** — você recebe notícia de cada movimentação relevante do processo pelo WhatsApp.

Fechar a seção com: *"Não cobramos para analisar se existe um caso, e dizemos com clareza quando não existe."*
[CONFIRMAR se essa frase reflete a política do escritório — se não, remover.]

### 5. O escritório
Texto institucional em duas colunas + foto. Origem, o que motivou a atuação com famílias de vítimas de acidente,
composição da equipe (advogados, acolhedores, apoio psicológico via ABRACI), abrangência nacional.
Card do responsável técnico: **Dr. Raymsandreson de Morais Prudêncio — OAB/PI 10.949**, breve currículo [CONFIRMAR].
Sem adjetivo de autoelogio.

### 6. ABRACI — o braço de acolhimento (`bg-muted/30`)
Cartão horizontal: logo à esquerda; à direita, o nome completo — **ABRACI — Associação Brasileira de Apoio às Famílias
Vítimas de Acidentes de Trabalho e de Consumo** — e um parágrafo explicando que a ABRACI
faz acolhimento presencial, apoio psicológico e assessoria documental às famílias — trabalho **distinto e complementar**
ao jurídico — e menção ao grupo de apoio **"Mulheres Guerreiras de Fé"**.
Botão externo: "Conhecer a ABRACI" → `https://familiaabraci.com.br` (`target="_blank"`, `rel="noopener"`).
**Sem depoimento, sem estrela, sem nota.**

### 7. WhatsJUD — tecnologia própria (seção curta, 1/3 da altura das outras)
Selo discreto "Software próprio · registrado no INPI". Título: **"O acompanhamento do seu processo é feito com
tecnologia que nós mesmos desenvolvemos."** Um parágrafo: plataforma de gestão jurídica criada dentro do escritório,
que centraliza atendimento por WhatsApp, prazos, audiências, perícias e movimentações — e por isso o cliente é avisado
quando algo anda. Três a quatro bullets no máximo. Link discreto "Saiba mais sobre o WhatsJUD" [CONFIRMAR destino].
**Não** listar preço, plano ou "teste grátis" aqui.

### 8. Perguntas frequentes — accordion shadcn, 8 itens
- "Preciso ir até Teresina para ser atendido?"
- "O que fazer nas primeiras horas depois de um acidente de trabalho?"
- "Meu benefício foi negado pelo INSS. Ainda dá para fazer alguma coisa?"
- "Quais documentos eu preciso separar antes de falar com vocês?"
- "Quanto tempo demora um processo previdenciário?" (responder com faixas gerais e a ressalva de que varia por caso e vara)
- "Fui dispensado depois do acidente. Isso pode?"
- "Motorista de aplicativo que sofre acidente tem algum direito?"
- "A ABRACI e o escritório são a mesma coisa?" — explicar a diferença com clareza.

Respostas informativas, 3 a 5 linhas, **sem prometer desfecho**.

### 9. Contato
Duas colunas.
- **Esquerda**: "Conte o que aconteceu. A gente responde." + os canais oficiais do escritório:
  **WhatsApp (86) 9447-3226** (link `https://wa.me/558694473226`) e **contato@rprudencioadv.com**;
  endereço **[CONFIRMAR — a ABRACI fica no Edifício Diamond Center Shopping, Bairro de Fátima, Teresina/PI;
  confirmar se o escritório funciona no mesmo endereço]**, horário de atendimento [CONFIRMAR]. Mapa embutido.
- **Direita**: formulário curto — Nome, WhatsApp (com máscara), E-mail, Assunto (select com as 5 áreas + "Outro"),
  Mensagem. `react-hook-form` + `zod`. Checkbox obrigatório: *"Autorizo o contato e o tratamento dos meus dados
  conforme a Política de Privacidade (LGPD)."* Feedback com `sonner`.
  Abaixo do botão: *"O envio desta mensagem não cria relação advogado-cliente."*

### 10. Rodapé
Três colunas: (a) logo + linha institucional; (b) navegação e áreas de atuação; (c) contato e redes.
Linha legal, discreta, em duas linhas:
**RAYMSANDRESON PRUDENCIO SOCIEDADE DE ADVOGADOS · CNPJ 32.965.023/0001-27**
**Responsável técnico: Raymsandreson de Morais Prudêncio · OAB/PI 10.949**

Todos os dados legais e de contato ficam centralizados em **`src/data/site.ts`**, num único objeto, e não espalhados
pelos componentes. Inclua nesse objeto o campo `oabSociedade: ""` (ainda a preencher): enquanto estiver vazio, o
rodapé **omite a linha** — não renderize `[CONFIRMAR]` nem placeholder algum em texto que vai ao ar. Quando o número
existir, basta preenchê-lo e a linha `Sociedade de Advogados — OAB/PI nº ___` aparece sozinha.
Rodapé final: `© {ano} Prudêncio Advogados. Todos os direitos reservados.` + Política de Privacidade · Termos de Uso.

## 5. Rotas por tipo de caso

Crie um **template único** `CasePage` alimentado por um array de dados (`src/data/cases.ts`), uma entrada por caso.
Cada página tem: breadcrumb · H1 do caso · "O que é" · "Quem costuma ter direito" (requisitos gerais, redigidos como
critérios da lei, **nunca** como "você tem direito") · "Documentos que costumam ser necessários" (checklist) ·
"Como atuamos nesse tipo de caso" · FAQ de 3 itens · CTA de contato · bloco "Casos relacionados".

Rotas (slug em `/atuacao/...`, para não colidir com as URLs da ABRACI, que já ocupam `/auxilio-acidente`, `/bpc-loas` etc.):

```
/atuacao/acidente-de-trabalho-obito
/atuacao/acidente-de-trabalho-sequela
/atuacao/doenca-ocupacional
/atuacao/estabilidade-acidentaria
/atuacao/reparacao-civil-acidente
/atuacao/acidente-motorista-aplicativo
/atuacao/auxilio-doenca
/atuacao/auxilio-doenca-acidentario
/atuacao/auxilio-acidente
/atuacao/aposentadoria-incapacidade
/atuacao/aposentadoria-idade
/atuacao/aposentadoria-contribuicao
/atuacao/aposentadoria-rural
/atuacao/aposentadoria-especial
/atuacao/revisao-de-beneficio
/atuacao/bpc-loas
/atuacao/bpc-autismo
/atuacao/bpc-tdah
/atuacao/bpc-esquizofrenia
/atuacao/bpc-depressao
/atuacao/bpc-doencas-ortopedicas
/atuacao/pensao-por-morte
/atuacao/salario-maternidade
/atuacao/seguros-sinistro-negado
```

**Regra de conteúdo**: o texto de cada página precisa ser **original e com ângulo jurídico** (o que se pede, em que via,
o que costuma travar, o que o escritório faz). Não reescreva o texto da ABRACI, que trata do ângulo documental — os dois
sites são do mesmo grupo e conteúdo duplicado prejudica os dois no buscador.

## 6. Outras rotas

- `/privacidade` — LGPD: dados coletados, finalidade, base legal, tempo de guarda, direitos do titular, encarregado [CONFIRMAR].
- `/termos` — termos de uso do site.
- `*` — 404 sóbria com botão de volta.

## 7. Requisitos técnicos

- Componentizar por seção, um arquivo cada; conteúdo em arrays de dados no topo ou em `src/data/`, fácil de editar.
- **Mobile-first**, testado em 360px, sem scroll horizontal.
- **Acessibilidade**: contraste AA, `alt` descritivo, foco visível, navegação por teclado, um único `h1` por página,
  accordion e formulário acessíveis.
- **SEO**: `<title>` e meta description por rota; Open Graph com imagem; JSON-LD `LegalService` na home (nome, endereço,
  telefone, `areaServed: BR`) e `FAQPage` nas páginas com FAQ; `sitemap.xml` com todas as rotas; `robots.txt`.
- **Performance**: `width`/`height` em toda imagem, `loading="lazy"` fora do hero, fontes com `display=swap`.
- Botão de WhatsApp: `https://wa.me/558694473226?text=` com mensagem pré-preenchida **por contexto** (a página de caso manda
  "Vim da página de [nome do caso] e queria tirar uma dúvida").
- Botão flutuante de WhatsApp no canto inferior direito, discreto, com `aria-label`.

## 8. O que NÃO fazer

- Não usar nada da landing antiga do WhatsJUD: "dinheiro infinito", "tô rico, tô pobre nunca mais", "plataforma #1",
  "10x mais produtividade", "500+ escritórios", "98% de satisfação". Não é verificável e não passa no crivo da OAB.
- Não copiar os depoimentos do site da ABRACI.
- Não citar os números de alcance da ABRACI (2.000+ famílias, 28 estados, nota 5.0) como se fossem do escritório.
- Não colocar preço, plano, "teste grátis" ou tabela de honorários.
- Não inventar nada: sem informação, deixe `[CONFIRMAR]` visível na tela.

Comece entregando a home `/` completa e responsiva com o design system configurado e o array de casos já populado.
As páginas de caso e as rotas legais vêm em seguida.

=== FIM DO PROMPT ===

---

## Checklist antes de publicar

| Item | Onde entra | Situação |
|---|---|---|
| ~~Razão social~~ | Rodapé, JSON-LD | **definida**: RAYMSANDRESON PRUDENCIO SOCIEDADE DE ADVOGADOS |
| ~~CNPJ~~ | Rodapé, JSON-LD | **definido**: 32.965.023/0001-27 |
| Nº de inscrição **da sociedade** na OAB/PI (distinto da inscrição pessoal) | Rodapé | falta |
| ~~OAB do Dr. Prudêncio~~ | "O escritório", rodapé | **definido**: OAB/PI 10.949 |
| ~~WhatsApp e e-mail do escritório~~ | Contato, todos os CTAs | **definido**: (86) 9447-3226 · contato@rprudencioadv.com |
| Endereço do escritório (a ABRACI fica no Ed. Diamond Center Shopping, Bairro de Fátima, Teresina/PI) | Contato, JSON-LD | confirmar se é o mesmo |
| Domínio de publicação — `rprudencioadv.com` presumido pelo e-mail | canonical, OG, sitemap | confirmar |
| Formato do WhatsApp no link `wa.me` (8 ou 9 dígitos) | Todos os CTAs | conferir — ver nota abaixo |
| Fotos reais do escritório e da equipe | Hero, "O escritório" | falta |
| Logos em vetor: Prudêncio, ABRACI, WhatsJUD | Navbar e seções | falta |
| Currículo curto do responsável técnico | "O escritório" | falta |
| Política de honorários na análise inicial | "Como trabalhamos" | confirmar |
| Encarregado de dados (DPO) | /privacidade | falta |
| Destino do link "Saiba mais sobre o WhatsJUD" | Seção 7 | definir |

## Fatos confirmados nas fontes (podem ir para o site sem receio)

- Sede em **Teresina/PI**; famílias atendidas em vários estados.
- Responsável: **Raymsandreson de Morais Prudêncio** (grafado "Raymerson"/"Raimersandreson" nos depoimentos do Google —
  padronizar no site).
- Contato oficial do escritório: **WhatsApp (86) 9447-3226** · **contato@rprudencioadv.com**.
- **RAYMSANDRESON PRUDENCIO SOCIEDADE DE ADVOGADOS** · CNPJ **32.965.023/0001-27** · responsável técnico **Raymsandreson de Morais Prudêncio, OAB/PI 10.949**.
- **ABRACI — Associação Brasileira de Apoio às Famílias Vítimas de Acidentes de Trabalho e de Consumo**:
  acolhimento presencial, apoio psicológico, assessoria documental, grupo "Mulheres Guerreiras de Fé";
  Instagram `@abraci.acidentedetrabalho`; site com blog, cursos, checklist de documentos e campanha de arrecadação.
- WhatsJUD: software próprio, registrado no INPI, criação em 27/09/2025, TypeScript/JavaScript/SQL.
- Taxonomia completa de casos: extraída das 17 páginas de serviço da ABRACI + módulos do WhatsJUD
  (previdenciário JF, INSS administrativo, trabalhista TRT22, BPC/autista, maternidade).

## Nota sobre o link do WhatsApp

O número informado — **(86) 9447-3226** — tem 8 dígitos. Montei os links como `wa.me/558694473226`, seguindo o mesmo
padrão que o site da ABRACI já usa (`wa.me/558688054381`, também com 8 dígitos). Se a linha for celular no formato de
9 dígitos (**9 9447-3226**), o link correto passa a ser `wa.me/5586994473226` — nesse caso é só trocar em
`src/data/site.ts`, que é onde o número deve ficar centralizado, e não espalhado pelos componentes.

## Nota sobre os dados legais do rodapé

Dois pontos a fechar antes de publicar:

1. **A sociedade tem inscrição própria na OAB**, com número distinto da inscrição pessoal. O art. 15 do Estatuto da
   Advocacia manda que o registro da sociedade conste do material de divulgação — então o rodapé precisa de
   `Sociedade de Advogados — OAB/PI nº ___`, além do `OAB/PI 10.949` do responsável técnico. Só o número pessoal não
   cobre a exigência.
2. **Confirmar de quem é o CNPJ 32.965.023/0001-27.** O grupo tem mais de uma pessoa jurídica — a documentação do
   WhatsJUD registra que a conta PJ do Banco Inter está no nome de **PRUDENCIO CAPITAL LTDA**, e não da banca. O CNPJ
   que vai no rodapé de site de advocacia tem que ser o **da sociedade de advogados**. Se este for o da Prudêncio
   Capital, ele não deve aparecer ali.

Presumi **OAB/PI** pela sede em Teresina. Se a inscrição for de outra seccional, é trocar nos dois lugares.

### Como descobrir o nº de registro da sociedade na OAB

Em ordem de rapidez:

1. **Papel timbrado, procuração, contrato de honorários ou substabelecimento já usados pelo escritório.** Sociedade
   registrada quase sempre já imprime `OAB/PI nº ___` no rodapé desses documentos. É o caminho mais rápido — olhar
   uma procuração recente antes de qualquer consulta.
2. **Certidão / certificado de registro da sociedade**, emitido pela OAB/PI no ato do registro, arquivado junto com o
   contrato social visado pela Ordem. É o documento de origem do número.
3. **CNSA — Cadastro Nacional de Sociedades de Advogados**: <https://cnsa.oab.org.br>. Consulta pública por razão
   social e seccional. Duas ressalvas do próprio sistema: o resultado é **meramente informativo** (não vale como
   certidão) e **só aparecem as sociedades que fizeram o recadastramento**. Não achar lá não significa não haver registro.
4. **Secretaria / Setor de Sociedades da OAB/PI** — pedir por razão social + CNPJ. É de lá que sai a certidão oficial,
   caso seja preciso comprovar.
5. **Petições já protocoladas em nome da sociedade** — costumam trazer o registro na qualificação dos outorgados.

**Conferência paralela do CNPJ**: consultar 32.965.023/0001-27 no Comprovante de Inscrição da Receita Federal e ver se
a razão social volta como `RAYMSANDRESON PRUDENCIO SOCIEDADE DE ADVOGADOS`. Se voltar outra coisa (ex.: PRUDENCIO
CAPITAL LTDA), o CNPJ do rodapé é o errado. Isso resolve de uma vez a pendência levantada no item 2 acima.
