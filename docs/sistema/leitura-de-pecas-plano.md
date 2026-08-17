# Leitura das peças dos autos — plano e esqueleto (16/08/2026)

**Nada disto está implementado.** É o desenho combinado com o Raym para transformar
os PDFs dos autos em dado, e o que já foi provado sem eles.

Contexto de por que isso importa: a carteira mostrava "pago R$ 0,00" com R$ 172 mil
de honorário recebido no caso 88, e o marco dizia "Levantamento / pagamento" num
processo que estava em execução com IDPJ. Documento é a única fonte que fecha as
duas pontas — o comprovante de pagamento e o teor da manifestação.

---

## 1. O que já dá para saber SEM ler PDF

A regra que o Raym trouxe: **no silêncio do executado presume-se pago; quando fica
inadimplente, o exequente se manifesta nos autos.** Ou seja, a *ausência* de
movimentação depois do vencimento é sinal.

Isso virou `vw_jm_parcela_leitura` (view, não grava nada):

| Leitura | Como se chega | Parcelas | Valor |
|---|---|---|---|
| `PAGO` | lançamento conciliado por `parte_id` + parcela | 351 | R$ 5.099.786,85 |
| `PAGO_PRESUMIDO` | venceu e o processo ficou em silêncio | 368 | R$ 583.622,06 |
| `INADIMPLENCIA_SUSPEITA` | houve manifestação em até 90 dias do vencimento | 88 | R$ 826.363,65 |
| `A_RECEBER` | parcela futura | 215 | R$ 46.440,00 |

**Validação obrigatória de qualquer mudança nesta regra:** rodar contra o caso 88
(`0011351-63.2022.5.15.0031`), que tem que devolver parcelas 1–8 `PAGO` e 9–11
`INADIMPLENCIA_SUSPEITA`. É a história real do processo, conferida nos autos.

**Armadilha já paga:** filtrar `categoria ilike 'indeniza%'` inclui "Indenização a
receber" e "Indenização comprada" e devolve falso `PAGO` — o caso 88 saiu com as 11
parcelas pagas na primeira tentativa. Só `upper(trim(categoria)) = 'INDENIZAÇÃO'`
é realizado.

---

## 2. O que só o documento resolve

- **Comprovante de pagamento juntado** — valor, data e a qual parcela se refere
- **Alvará de levantamento** — quanto saiu de fato, e para quem (cota × honorário)
- **Teor da manifestação** — inadimplência? execução frustrada? devedor sem bens?
- **Petição inicial** — data do acidente, empresa, função e salário da vítima, que é
  o que falta nas 12 fichas mínimas de `jm_processos` (flag `FICHA_MINIMA_CADASTRAR_COMPLETO`)

---

## 3. Onde a função tem de morar (e por quê)

O bucket `jm-autos` é **privado**. Quem assina URL é `jm-documento-url`, que roda no
**Railway** (ver `src/lib/functionRouter.ts`). Portanto a função de leitura nasce no
Railway, não no Supabase: lá ela já tem a service key para assinar a URL e a chave do
provedor de LLM.

Fluxo por peça:

```
jm_documentos.storage_path
  -> assina URL (mesma lógica de jm-documento-url)
  -> LLM multimodal (classify-document já faz isso para PDF/imagem)
  -> grava em jm_documento_leitura
```

O disparo em lote pode sair do próprio banco por `pg_net`, no mesmo desenho de
`jm_esc_disparar` — que já chama edge function e tem `jm_esc_confirmar`/`jm_esc_colher`
lendo `net._http_response`. Assim a fila fica em SQL, auditável, e não depende de
nenhum worker novo.

---

## 4. Tabela proposta

```sql
create table public.jm_documento_leitura (
  id                bigserial primary key,
  documento_id      bigint not null references public.jm_documentos(id),
  processo_cnj      text   not null,
  -- o que a peça é, na régua do escritório
  especie           text,          -- COMPROVANTE_PAGAMENTO | ALVARA | MANIFESTACAO_INADIMPLENCIA
                                   -- | DECISAO | DESPACHO | PETICAO_INICIAL | OUTRO
  -- o que ela diz de dinheiro
  valor             numeric,
  data_evento       date,
  n_parcela         integer,
  parte_id          text references public.jm_partes(parte_id),
  destino_valor     text,          -- COTA_CLIENTE | HONORARIO | AMBOS | INDEFINIDO
  -- o que ela diz de estado
  inadimplencia     boolean,
  sem_bens          boolean,
  -- rastro
  confianca         numeric,       -- 0..1 devolvido pelo modelo
  resumo            text,
  texto_extraido    text,
  modelo            text,
  custo_estimado    numeric,
  lido_em           timestamptz not null default now(),
  revisado_por      uuid,          -- quem conferiu na mão; null = só a IA viu
  revisado_em       timestamptz
);

create index on public.jm_documento_leitura (processo_cnj);
create index on public.jm_documento_leitura (especie) where especie is not null;
create unique index on public.jm_documento_leitura (documento_id);
```

**Regra dura:** nada que sai daqui vira `valor_pago` sozinho. O que o LLM extrai é
alegação de peça, não fato conciliado — `revisado_por` é o que promove a leitura a
número oficial. Vale a mesma régua do Modo Leopardo: migração aditiva, conciliação
fecha antes de virar tela.

---

## 5. Custo e ordem de execução

São **8.783 documentos** hoje. A ~R$ 0,05–0,15 por peça, ler tudo custa entre R$ 400
e R$ 1.300. Não vale — a ordem que rende é:

1. **Peças dos 6 processos com `INADIMPLENCIA_SUSPEITA`** (R$ 826 mil em jogo) — confirma
   ou derruba a suspeita e fecha o estágio das 88 parcelas
2. **Alvarás e comprovantes dos 23 processos com `PAGO_PRESUMIDO`** (R$ 583 mil) — troca
   presunção por prova
3. **Petição inicial dos 12 processos com ficha mínima** — preenche acidente, empresa,
   vítima
4. O resto, se e quando fizer sentido

---

## 6. Pendências que atrapalham isto e são anteriores

- **`jm_documentos` duplica**: 8.783 linhas em 2.726 grupos (até 40 vias do mesmo
  título/data). `jm_esc_colher_docs` insere sem deduplicar e não guarda o id do
  documento no Escavador — `link_api` é o endpoint do processo, igual para todas as
  peças. Sem esse id **não dá para distinguir duplicata real de duas peças distintas
  do mesmo dia**, e ler tudo multiplicaria o custo por 3. Corrigir o colher primeiro.
- **Fila do Escavador travava em silêncio**: 38 solicitações presas em `ENVIANDO`,
  32 delas já com documento colhido e crédito debitado — só o status não fechava,
  porque `jm_esc_confirmar` só olha 30 minutos de `net._http_response`. E
  `jm_esc_reabrir_por_cnj` não reabre `ENVIANDO`, então ficariam presas para sempre.
