---
name: marcos-pop-e-captura
description: Use SEMPRE que a tarefa envolver marcos processuais, fases de POP, jurimetria, valor de carteira, ou a captura automática (e-mail push, DataJud, Escavador). Guarda as três armadilhas que já custaram caro — número inflado 2,6x, estado virando fase e cron que falha em silêncio. Acione ao ouvir "marco", "fase do POP", "jurimetria", "carteira", "quanto vale", "Escavador", "DataJud", "push", "atualização de processo", "movimentação".
---

# Marcos, POP e captura automática

Metáfora: o **marco** é a placa de quilometragem da estrada — diz onde o processo está.
O **POP** é o manual de bordo — diz o que a equipe faz naquele trecho. Desde ago/2026 são
a mesma coisa: cada fase do POP É um marco. A **captura** é quem lê as placas por nós.

---

## 1. Marco é fase. Estado não é marco.

Regra do usuário, literal: *"marco pela etimologia da palavra não pode ser um estado"*.

| Isto é fase (marco) | Isto é estado (resultado) |
|---|---|
| Ajuizamento, Audiência inicial, Perícia, Sentença, Recurso, TST, Execução, Alvará, Arquivamento | **Acordo homologado**, **Suspensão** |

Estado ganha `atravessa_fases = true` e **nunca** entra no cálculo da fase atual.

```sql
-- certo: fase atual ignora quem atravessa
where not atravessa_fases
order by cnj_num, ordem desc, data_detectada desc
```

**Por que importa:** Acordo (ordem 26) e Suspensão (27) têm a maior ordem da régua. Como
"maior ordem vence", eles apareciam como fase atual de **61 processos**, escondendo onde
esses processos estavam de verdade. Acordo homologado no TST não põe o processo numa fase
"acordo" — ele continua no TST, com um acordo. Viraram coluna (`tem_acordo`, `suspenso`).

### O que mais mudou junto
- "Status possíveis do POP" → **"Resultados possíveis do POP"**, e cada resultado pode
  declarar `estagio` financeiro próprio. Sem isso, Indeferido/Extinto/Desistido eram
  carimbados como CONDENAÇÃO — os quatro compartilham trânsito em julgado.
- "Instrução e Julgamento" se parte em três: Perícia, Audiência de instrução, Sentença.
- Todas as fases ficam visíveis sempre.
- **Responsável em cascata** — `src/lib/popResponsavel.ts`: passo → objetivo → fase →
  processo. Definir no nível de cima vale para tudo abaixo sem responsável próprio.
- **Prazo por passo** — `src/lib/popPrazo.ts`: dias úteis, dias corridos ou meses.
  Feriado **não** é considerado; está declarado no arquivo.

Tabelas: `pop_marcos`, `pop_marco_sinais` (Externo). POP de referência: board
`Trabalhistas judicial — marcos (rascunho)`.

### O progresso do processo NÃO mora no checklist

Erro que já custou meio dia: tratar a migração de checklist como se fosse a migração do POP.

| O que mede | Onde mora |
|---|---|
| **Progresso do processo** (estação X de Y) | `process_pop_marcos` + `pop_marcos` — **é isto** |
| Barra do lead / % do funil | `lead_checklist_instances` via `calculateHierarchicalProgress` |
| Produtividade da equipe | passos e objetivos dos checklists |

Passo e objetivo são **instrução de como conduzir** — não são o progresso. Trocar o POP de
marcos exige repontar `process_pop_marcos` (o dado do progresso), `pop_marco_gabarito` e
`pop_fontes`; o que publica de fato é `team_workflow_boards`. Migrar checklist é opcional
— serve só para o processo não chegar com a ficha em branco.

**Executado em 12/08/2026:** 1.432 detecções, 331 gabaritos e 2 fontes repontados para o
board de marcos; 644 checklists migrados junto. Backups `zz_*_bkp_20260812`.

### Três armadilhas desta migração, todas medidas

1. **Índice parcial `uniq_lci_por_lead`** `(lead_id, board_id, stage_id, checklist_template_id) WHERE process_id IS NULL`.
   Quando dois stages antigos viram um marco só, o mesmo lead fica com duas instâncias
   disputando a vaga. Foram 22 pares. Resolvido mantendo a mais completa e deixando a
   duplicata no board antigo — nada apagado.
2. **Confira instância × destino, não template × template.** Validar a partição comparando
   os dois templates diz que "20 = 10+7+3, tudo casa" e mesmo assim 135 passos marcados
   ficam para trás: as instâncias guardam ids de versões anteriores do POP. A conferência
   só vale se for medida contra as instâncias, no mesmo instante do INSERT.
3. **Edição concorrente do POP.** Um save do editor às 20:28 reescreveu os 26 templates em
   10 segundos e zerou três objetivos (nome virou "Objetivo", 0 passos). Antes de migrar,
   confira `checklist_templates.updated_at`; se estiver fresco, alguém está no editor.
   Recuperação: `workflow_revisions`, que guarda o snapshot completo por revisão.

**Pendente:** migrar os checklists com trabalho já feito para os marcos. Plano vigente em
`supabase/migrations-external/PLANO_20260812_migrar_checklists_para_marco.sql` — o prefixo
`PLANO_` existe para **não** rodar sozinho. O plano de 08/08 está marcado ⛔ OBSOLETO: ele
mapeava os templates antigos, e o board rascunho ganhou 26 templates **próprios**
(interseção zero). Medido em 12/08: 8.968 instâncias, **727** com trabalho.

### Ao migrar, o que decide o estrago é o `id` do passo

A instância guarda os `items` **completos** (label, checked, docChecklist) — não um
ponteiro. Mover instância não apaga nada. Quem decide é `syncInstanceItems`
(`src/lib/syncChecklistInstances.ts`), que compara instância × template **por id**:

| no template novo | resultado |
|---|---|
| mesmo id, mesmo label | passa intacto, marcado |
| mesmo id, label mudou | `needsRedo` → histórico riscado **+ passo reaberto desmarcado** |
| id não existe | fica com selo `removido do POP` |

Medido: **3.278 de 3.304 passos marcados (99,2%) passam intactos**; 9 reabrem, 17 riscam.
Sempre rode essa conta antes de migrar checklist — um label com espaço à direita no
template novo respondia por 8 das 9 reaberturas.

---

## 2. Nunca some `jm_valores` direto

`jm_valores` tem **uma linha por (decisão × cliente)**. Cada decisão que confirma o valor
cria linha nova para a mesma pessoa — MARIA aparece com R$ 550.000 na sentença e mais
R$ 550.000 nos embargos. É o mesmo dinheiro, dito duas vezes.

```
soma bruta ....................... R$ 83.228.467
última decisão de cada cliente ... R$ 31.622.209   ← o número certo
```

**2,6x inflado, e para cima** — o pior lado para número que vai a relatório de fundo.

```sql
-- sempre assim
select distinct on (v.processo_cnj, v.cliente) ...
  order by v.processo_cnj, v.cliente, d.data_decisao desc nulls last
```

O join com `lead_processes` duplica de novo (26 números repetidos, um deles 4×) — também
pede `DISTINCT ON`. Granularidade é **(processo × cliente)** por litisconsórcio: ao
agrupar, processos contam distintos e valores somam.

**Limite conhecido:** o número é "quanto o processo vale", **não** "quanto entra no caixa"
— não separa cota do cliente de honorário do escritório. Ao apresentar, diga isso.

Tela: `src/pages/CarteiraPorFasePage.tsx` · view: `vw_pop_carteira_por_fase`.

---

## 3. A cadeia de captura, na ordem

```
e-mail push  →  DataJud  →  Escavador
(quem mexeu)    (o que      (o documento,
                mudou, e     só de quem
                se tem doc)  tem)
```

| Fonte | Custo | Tempo real? | Traz |
|---|---|---|---|
| E-mail push (Gmail) | zero | sim | o **gatilho**: quem teve movimentação |
| DataJud (CNJ) | zero | **não** — piso de 8 dias | código TPU da movimentação |
| Escavador | R$ 0,20 público | sim | o documento em si |

Não são redundantes: o DataJud dá o código de graça, o Escavador dá o documento e o tempo
real. Roda **uma vez por dia à meia-noite BRT** = `0 3 * * *` no cron (o servidor é UTC).

Painel: `CapturaStatusPanel` no sino, view `vw_jm_captura_status`. O gasto exibido não é
estimativa — vem de `jm_esc_solicitacoes.creditos`, o que a própria API devolve.

### Armadilha: cron que falha em silêncio

A URL certa do Railway é **`adscore-keeper-production.up.railway.app`**. Vários crons
antigos nasceram com `adscore-railway-production` (não existe) e levavam 404
`Application not found` a cada disparo — por duas semanas, sem uma linha de log.

Motivo: `net.http_post` só **enfileira** a chamada. Ninguém lê `net._http_response`. O
erro volta para o vazio.

```sql
-- diagnóstico: dispare na mão e LEIA a resposta pelo id retornado
select net.http_post(url := '...', headers := '...', body := '{}'::jsonb);  -- devolve id
select status_code, left(content::text, 400) from net._http_response where id = <id>;
```

Sintoma: painel do sino com **zero em todas as filas** enquanto o Gmail recebe dezenas de
push por dia. Antes de suspeitar de token vencido ou edge não deployada, cheque a URL.

`net._http_response` também **expira em ~6h** — resposta perdida trava a fila para sempre.

**Pendente:** a caixa administrativa (`inbox#3` — INSS, MPT, relatórios de investigação de
acidente) tem `body_text` preenchido, mas nenhuma IA lê esse texto. Nenhum POP
administrativo tem marco cadastrado; o tipo `'texto'` em `pop_marco_sinais` foi criado
para isso e está vazio.

---

## Checklist antes de entregar

- [ ] Marco novo que é estado ganhou `atravessa_fases = true`?
- [ ] Toda soma de valor passa por `distinct on (processo_cnj, cliente)`?
- [ ] Ao mostrar dinheiro, ficou claro que é valor do processo e não caixa do escritório?
- [ ] Cron novo: a URL foi conferida disparando e **lendo** `net._http_response`?
- [ ] Código TPU: 237/238/239 é provimento em 2º grau. 219/220/221 é procedência, **só G1**.
- [ ] Audiência só conta com complemento `realizada` — designada não é marco (840
      designadas vs 526 realizadas; contar designação dava mediana de 7 dias).
