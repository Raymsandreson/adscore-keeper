# Radar de empresa — processos por ano e por matéria (Escavador)

Responde: *"quantos processos por ano essa empresa tem, e quantos são de
acidente de trabalho ou doença ocupacional?"* — para um CNPJ ou para a **raiz
inteira** (matriz + filiais).

## Onde fica

**Processual → Jurimetria → Radar de empresa** (`/processual/jurimetria-empresa`).

Também dá para rodar em lote pela linha de comando:

```bash
# um CNPJ, com o token do Escavador na mão
ESCAVADOR_API_TOKEN=xxx npm run radar:empresa -- 01588098000102 --out /tmp/atlantica

# a raiz inteira, até a filial 80, passando pela edge (sem token local)
npm run radar:empresa -- 01.588.098/0001-02 --raiz --ate-ordem 80 --via-edge
```

Flags: `--raiz`, `--ate-ordem N` (default 20), `--max-paginas N` (default 20),
`--via-edge`, `--out DIR` (grava `processos.json`, `processos.csv`, `por-ano.csv`).

## Peças

| Arquivo | Papel |
|---|---|
| `src/lib/processosDaEmpresa.ts` | Regra pura: dígito verificador/raiz, classificação da matéria, agregação por ano, CSV, leitura da paginação. **Fonte única** — tela e CLI usam a mesma. |
| `src/hooks/useRadarEmpresa.ts` | Varredura serial pela edge `search-escavador`, com progresso, avisos por CNPJ e botão de parar. |
| `src/pages/JurimetriaEmpresaPage.tsx` | A tela. Detalhe do processo abre em `Sheet`, sem sair da lista. |
| `scripts/escavador-processos-por-cnpj.mjs` | CLI. Importa a lib TS via `node --experimental-strip-types`. |
| `src/lib/__tests__/processosDaEmpresa.test.ts` | 19 casos: DV contra CNPJs reais, classificação, agregação, percentual, CSV, paginação. |

## Como classifica

Lê a **capa** de cada processo (`fontes[0].capa`: classe, área,
`assuntos_normalizados`, `data_distribuicao`) e casa por termo:

- **ACIDENTE** — acidente de trabalho/do trabalho, de trajeto, *in itinere*, acidentária
- **DOENÇA** — doença ocupacional/profissional/do trabalho, moléstia profissional, LER/DORT, PAIR
- **AMBOS**, **OUTRO**
- **INDETERMINADO** — a capa veio sem assunto **e** sem classe

Ano = `data_distribuicao` → `data_inicio` → `ano_inicio`; sem nenhum, `sem_data`
(e `sem_data` não entra na média por ano).

## O que ele NÃO faz — de propósito

- **Não chuta matéria.** `INDETERMINADO` é contado à parte e o percentual sai
  sobre o que deu para classificar (`total − indeterminado`). Dividir pelo total
  trataria "não sei" como "não é" e empurraria o percentual para baixo. Para
  resolver um indeterminado é preciso abrir a capa completa
  (`GET /processos/numero_cnj/{cnj}`), que é consulta paga por processo.
- **Não inventa a lista de filiais.** O modo raiz **gera** os CNPJs pelo dígito
  verificador (`raiz + ordem + DV`) e varre de 0001 até o limite que você
  informar. Isso é varredura, não cadastro: ordem que nunca foi aberta apenas
  não devolve processo. Quem já tem a lista real da Receita deve consultar CNPJ
  a CNPJ em vez de varrer.
- **Não afirma o polo sem prova.** "Papel da empresa" só sai como réu/autor
  quando o envolvido com **aquele** CNPJ vem na resposta; comparar por razão
  social erraria dentro de grupo econômico. Sem isso, fica "não informado".
- **Não esconde buraco.** CNPJ que falhou, ou que parou na trava de páginas,
  vira aviso na tela e no CSV — o total sai marcado como incompleto em vez de
  parecer completo.
- **Não conta o mesmo processo duas vezes.** Matriz e filial podem ser partes da
  MESMA ação; a varredura une por número CNJ, avisa quantos foram unidos e o
  detalhe mostra todos os CNPJs que acharam aquele processo. Sem isso o volume
  da empresa — o número que se usa para precificar — sairia inflado.
- **Não relê a mesma página.** Se a busca devolver a página que já veio (é o que
  a edge sem repasse de cursor faz), a varredura para naquele CNPJ e avisa, em
  vez de multiplicar a primeira página pela trava de páginas.
- **Não é "todos os processos da empresa"** — é o que o Escavador indexou.
  Segredo de justiça e tribunal fora da cobertura não aparecem.

## Custo

Cada página de cada CNPJ é consulta paga. A tela mostra quantos CNPJs serão
consultados **antes** de começar, exibe o progresso CNPJ a CNPJ e pode ser
interrompida no meio. Uma raiz com 73 filiais é da ordem de 73 consultas-base
(mais páginas extras nas filiais com muito processo).

## Dependência de deploy

O modo com mais de uma página depende da correção de paginação em
`supabase/functions/search-escavador` (a action `buscar_por_cpf_cnpj` passou a
repassar `cursor`). Enquanto essa edge não for deployada no Externo
(`kmedldlepwiityjsdahz`, que é para onde o `functionRouter` manda
`search-escavador`), a tela traz só a primeira página de cada CNPJ — e avisa.
