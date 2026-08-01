# Base analítica de CAT — detecção de padrões para ação coletiva

Consolidação dos dados abertos de **Comunicação de Acidente de Trabalho (CAT)** do INSS/Dataprev
para sustentar, com evidência estatística, a tese de conduta ilícita continuada do empregador
em ações civis públicas e litígios coletivos.

## Origem dos dados

Pasta Drive **"Relação de todas as CAT"** (`12cA3T0zFuBljNAPduTlypmwwthokripY`):
36 arquivos `D.SDA.PDA.005.CAT.AAAAMM.ZIP`, competências **jun/2023 a mai/2026**, 433 MB compactados.

Cada ZIP traz o mesmo conteúdo em três formatos (`.csv`, `.json`, `.xml`). Usamos o **CSV**.

### Layout do CSV (verificado em `D.SDA.PDA.005.CAT.202512.csv`)

- Separador `;`, encoding **latin-1** (não é UTF-8), 27 colunas, sem aspas.
- Campos de texto vêm padded/truncados em **20 caracteres** — `"Fabricacao de Equipa"`,
  `"Reacao do Corpo a Mo"`. Os **códigos** (CBO, CID-10, CNAE, município) vêm íntegros;
  para descrição completa, juntar com `public.cbo_professions` por `cbo_codigo`.
- Datas em `dd/mm/aaaa`; ausência é `00/00/0000` → convertida para `NULL`.
- Não classificado aparece como `{ñ class}`, `Ignorado`, `Zerado` → convertido para `NULL`.
- O cabeçalho **repete nomes**: `CBO;CBO`, `CID-10;CID-10`, `CNAE;CNAE` (1º código, 2º descrição)
  e `Data Acidente` aparece duas vezes (colunas 2 e 23) com o mesmo valor.

### O achado que viabiliza tudo

A última coluna é **`CNPJ/CEI Empregador`**, preenchida. É isso que permite agrupar
acidentes por empresa. Sem ela, a base só serviria para estatística agregada.

Não há PII do trabalhador: sem nome, sem CPF. Há sexo, data de nascimento, CBO e município —
quase-identificantes. Por isso a tabela fica com RLS e leitura só para autenticado.

### Ressalva de qualidade

Na amostra de 202512, `UF Munic. Acidente` apareceu **inconsistente** com o município do
empregador (ex.: município de Moji-Mirim/SP com UF do acidente "Maranhão"). **Não usar esse
campo como filtro geográfico primário** — preferir `municipio_empregador_*`. Validar em volume
antes de qualquer conclusão territorial.

## Por que Supabase e não Excel

O Excel trava em **1.048.576 linhas por planilha**. Com volume oficial na casa de 600–800 mil
CATs/ano, 3 anos de dados passam desse teto — a base inteira **não cabe** numa planilha.
Além disso, o cruzamento que interessa (empresa × dinâmica × tempo) é `GROUP BY` com janela,
não fórmula de planilha.

O Excel continua útil, mas como **saída derivada**: os resultados das views abaixo têm
centenas ou poucos milhares de linhas e exportam sem problema para a petição.

## Estrutura

| Objeto | O que é |
|---|---|
| `public.cat_acidentes` | Dump analítico, uma linha por CAT. Sem PII. |
| `public.cat_import_runs` | Controle de carga, uma linha por competência. Permite retomar. |
| `public.mv_cat_padrao_empresa` | **Materializada.** Empregador × dinâmica com 2+ ocorrências. |
| `public.vw_cat_nexo_epidemiologico` | Padrões com 3+ ocorrências, com `forca_indicio`. |
| `public.vw_cat_inercia_empregador` | Acidentes ocorridos **depois** do primeiro do mesmo padrão. |
| `public.vw_cat_ranking_empresa` | Totais por CNPJ, óbitos, nº de padrões reiterados. |
| `public.vw_cat_obitos_empresa` | Recorte de óbitos. |
| `public.vw_cat_cluster_setorial` | Mesma dinâmica em 3+ empresas do mesmo CNAE/município. |
| `public.vw_cat_padrao_com_lead` | Cruza padrões com `cat_leads` (onde já temos contato). |

**`cat_acidentes` é separada de `cat_leads` de propósito.** `cat_leads` (278 linhas) é
operacional: CAT já enriquecida com CPF, nome, telefones e resultado de ligação, ligada ao CRM.
`cat_acidentes` é analítica: bruta, completa, sem PII, na ordem de milhões de linhas.
A ponte entre as duas é `cnpj_cei_empregador`.

## Mapeamento tese jurídica → consulta

| Elemento da causa de pedir | Onde olhar |
|---|---|
| Nexo causal epidemiológico (3+ acidentes de mesma dinâmica) | `vw_cat_nexo_epidemiologico` |
| Mesma causa raiz | chave da view: agente causador + parte do corpo + natureza da lesão |
| Repetição em curto espaço de tempo | `concentrado_12m` e `janela_dias` |
| **Inércia do empregador** | `vw_cat_inercia_empregador.acidentes_apos_180d_do_1o > 0` |
| Gravidade / dano moral coletivo | `qtd_obitos`, `vw_cat_obitos_empresa` |
| ACP setorial (réu não é uma empresa só) | `vw_cat_cluster_setorial` |

A coluna mais forte é **`acidentes_apos_180d_do_1o`**: ela quantifica quantos acidentes idênticos
ocorreram mais de seis meses depois do primeiro. É a tradução em número da alegação de que,
mesmo após o alerta, nenhuma medida de engenharia ou treinamento foi adotada.

### Exemplos

```sql
-- Alvos prioritários: padrão reiterado, concentrado e com óbito
select * from public.vw_cat_nexo_epidemiologico
where forca_indicio in ('crítico','muito forte')
order by qtd_obitos desc, qtd_acidentes desc
limit 50;

-- Prova de inércia: empresa seguiu tendo o mesmo acidente depois de 1 ano
select * from public.vw_cat_inercia_empregador
where acidentes_apos_1ano_do_1o >= 2
order by qtd_total desc;

-- Recorte por região e ramo
select * from public.vw_cat_ranking_empresa
where uf = 'São Paulo' and total_cats >= 10
order by obitos desc, total_cats desc;
```

## Importação

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role> \
node scripts/importar-cat-dataprev.mjs /caminho/pasta-com-zips
```

- `--dry-run` valida o parsing sem gravar (não precisa de credencial).
- `--so=202601` processa só uma competência.
- **Idempotente**: `hash_linha` é `UNIQUE`; recarregar o mesmo arquivo é no-op.
- **Retomável**: competência com status `ok` em `cat_import_runs` é pulada.
- **Streaming**: usa `unzip -p` e processa linha a linha. Os maiores CSVs passam de 90 MB
  descompactados — ler inteiro estouraria a memória.
- Requer o binário `unzip` no PATH. Sem dependência npm nova.

Depois de cada carga:

```sql
refresh materialized view concurrently public.mv_cat_padrao_empresa;
```

## Validação feita (01/08/2026)

Migrations aplicadas em PostgreSQL 16 local, sem erro. Amostra real de 94 linhas da competência
202512 carregada e verificada:

- parsing: 94/94 mapeadas, 0 rejeitadas;
- datas `00/00/0000` → `NULL`; `24/09/2025` → `2025-09-24`;
- município `353080-Moji-Mirim` separado em código e nome;
- colunas geradas `cnpj_raiz` e `ano_acidente` corretas;
- as 7 views executam;
- idempotência confirmada: reinserir as mesmas 94 linhas resulta em `INSERT 0 0`;
- `refresh materialized view concurrently` funciona (índice único presente);
- **a detecção funciona**: em 94 linhas de um mês parcial, já apareceram 2 empregadores com
  acidentes de dinâmica idêntica em janelas de 6 e 24 dias.

Pendente de validação em volume real: contagem total de linhas, tempo de `REFRESH` e
consistência do campo `UF Munic. Acidente`.
