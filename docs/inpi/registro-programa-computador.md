# Registro de Programa de Computador no INPI — pacote do depósito

Preparado em 21/07/2026. Sistema: **e-Software** (100% eletrônico, prazo médio de ~10 dias para o certificado). Validade do registro: 50 anos contados de 1º de janeiro do ano seguinte à criação.

---

## 1. Objeto do depósito (já gerado)

| Item | Valor |
|---|---|
| Arquivo | `inpi-deposito-f2121475b.zip` (na raiz do projeto — **guardar cópia em local seguro**) |
| Conteúdo | Todo o código-fonte versionado (1.739 arquivos, commit `f2121475b79907d5a89fb39812a80fad7073c091`) |
| Algoritmo de resumo | **SHA-512** |
| Hash (resumo digital) | `e186e7e10d69caf64b168029905dd676313cb7343387378f7d6d4b8591f132fa0e4f7e79615327e3c238dadf5acd4495f9941ef2f2a78add0733c87567dfb66f` |

O INPI **não recebe o código** — apenas o hash declarado no formulário. O arquivo `.zip` é a prova material: quem detém o arquivo cujo hash bate com o do certificado prova a anterioridade. Por isso, guardar o zip em pelo menos dois lugares (ex.: Drive do escritório + backup offline).

**Reproduzir o arquivo a qualquer momento** (determinístico a partir do commit):

```bash
git archive --format=zip -o inpi-deposito-f2121475b.zip f2121475b79907d5a89fb39812a80fad7073c091
sha512sum inpi-deposito-f2121475b.zip
```

## 2. Passo a passo do depósito

1. **Cadastro no e-INPI** (Meu INPI) com o CPF/CNPJ do titular, se ainda não houver.
2. **Emitir e pagar a GRU** — serviço "Registro de Programa de Computador" (código de serviço **730**). Taxa na faixa de R$ 200 (conferir a tabela vigente no site do INPI).
3. **Acessar o e-Software** com o mesmo login e preencher o formulário eletrônico (dados da seção 3 abaixo), informando o nº da GRU paga.
4. Assinar a declaração de veracidade e **protocolar**. O certificado sai em formato digital.

## 3. Dados para o formulário

| Campo | Sugestão de preenchimento |
|---|---|
| Título do programa | AdScore Keeper / WhatsJUD — Sistema de gestão jurídica com IA |
| Data de criação | **27/09/2025** (primeiro commit do repositório — evidência em git) |
| Titular(es) | **[razão social do escritório + CNPJ]** — confirmar se o titular será a PJ ou pessoa física |
| Autor(es) | **[nome(s) e CPF(s) de quem criou/dirigiu o desenvolvimento]** |
| Linguagens | TypeScript, JavaScript, SQL (PL/pgSQL) |
| Campo de aplicação / tipo | selecionar nas tabelas do formulário as opções de **administração/gestão** e **aplicativo** correspondentes ao ramo jurídico |
| Algoritmo hash | SHA-512 |
| Resumo digital (hash) | colar o hash da seção 1 |
| Derivação | programa original (não derivado) |

**Descrição funcional (se solicitada)**: "Sistema web de gestão para escritórios de advocacia: captação e triagem de leads (inclusive a partir de notícias, com enriquecimento por inteligência artificial), funis Kanban, gestão de casos e processos judiciais e administrativos (INSS), agenda de audiências, atendimento via WhatsApp com agentes de IA, registro de atividades com preenchimento por voz, cronômetro/banco de horas, telões de produtividade, relatórios em linguagem natural e controle financeiro via Open Finance." (Documentação completa em `docs/sistema/`.)

## 4. Depósitos futuros (versões)

O registro protege a versão depositada. A cada evolução relevante (ex.: anual, ou marco grande de funcionalidade), gerar novo zip do commit da época, novo hash e novo depósito como **versão derivada** do registro anterior. O histórico git já serve de prova contínua entre depósitos.

## 5. Complementos recomendados

- **Marca**: registrar "WhatsJUD" (e a marca do escritório, se aplicável) no INPI — classe de software/serviços jurídicos (Nice 9/42/45; o formulário orienta).
- **Segredo de negócio**: minuta de cláusula em `docs/juridico/clausula-segredo-negocio.md`.
- **Documentação funcional datada**: `docs/sistema/` versionada em git.
