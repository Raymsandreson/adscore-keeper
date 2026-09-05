# Processos de uma empresa por ano e por matéria (Escavador)

Responde: *"quantos processos por ano essa empresa tem, e quantos são de
acidente de trabalho ou doença ocupacional?"*

## Como rodar

```bash
# direto na API v2 (precisa do token do Escavador na mão)
ESCAVADOR_API_TOKEN=xxx node scripts/escavador-processos-por-cnpj.mjs 01588098000102 --out /tmp/atlantica

# sem token local, passando pela edge search-escavador (usa VITE_SUPABASE_* do .env)
node scripts/escavador-processos-por-cnpj.mjs 01588098000102 --via-edge
```

Flags: `--max-paginas N` (trava de custo, default 20) e `--out DIR`
(grava `processos.json` + `por-ano.csv`).

## O que ele faz

1. `GET /api/v2/processos/cnpj/{cnpj}` e segue `links.next` até acabar ou bater
   a trava de páginas. Seguir a URL inteira do `next` evita o mesmo tropeço da
   rota de OAB, cujo `next` carrega parâmetro de cobrança além do cursor.
2. Lê a **capa** de cada processo (`fontes[0].capa`) — classe, área,
   `assuntos_normalizados`, `data_distribuicao` — com o mesmo mapeamento de
   `supabase/functions/_shared/escavadorCapa.ts`.
3. Classifica a matéria por termo do assunto/classe:
   - `ACIDENTE` — acidente de trabalho/do trabalho, trajeto, *in itinere*, acidentária
   - `DOENCA` — doença ocupacional/profissional/do trabalho, moléstia profissional, LER/DORT, PAIR
   - `AMBOS`, `OUTRO`
   - `INDETERMINADO` — a capa veio **sem** assunto e sem classe
4. Agrega por ano de distribuição (`data_distribuicao` → `data_inicio` →
   `ano_inicio`; sem nenhum deles, ano `sem_data`).

## O que ele NÃO faz (de propósito)

- **Não chuta.** Processo cuja capa não trouxe matéria vira `INDETERMINADO` e é
  reportado à parte. Somar esses como "não é acidente" produziria um percentual
  bonito e errado. Para resolver um `INDETERMINADO` é preciso abrir o processo
  (`GET /processos/numero_cnj/{cnj}`), que é consulta paga por processo.
- **Não separa polo.** A busca por CNPJ traz processo em que a empresa aparece,
  ré ou autora. Quem quer só o polo passivo filtra por `titulo_polo_passivo` no
  `processos.json`.
- **Não cobre o que o Escavador não indexou** — processo em segredo de justiça
  ou tribunal fora da cobertura não aparece, e nenhum total daqui é "o total de
  processos da empresa", e sim "o que o Escavador tem".

## Custo

Cada página é consulta paga. Uma empresa com 73 filiais e milhares de processos
pode render dezenas de páginas — por isso a trava default de 20 páginas, que
avisa quando parou em vez de truncar em silêncio.

## Testes

`src/lib/__tests__/escavadorProcessosPorCnpj.test.ts` trava a classificação e a
agregação (inclusive "capa vazia nunca vira OUTRO").
