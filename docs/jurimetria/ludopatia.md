# Jurimetria — Ludopatia / Lei das Bets (14.790/2023)

Pipeline para responder: **como os tribunais estão decidindo, tempo médio, valores de condenação e principais advogados** em casos de ludopatia / nulidade de apostas.

## Por que precisou de código novo

A integração Escavador que já existia (`search-escavador`, **API v2**) só busca **processo específico** — por número CNJ, nome, CPF/CNPJ ou OAB. **Não há busca por assunto na v2**, nem endpoint de jurimetria pronta (tempo médio, valor médio, ranking de advogados). Confirmado no SDK oficial (`Escavador/escavador-python`) e na doc.

A única fonte de "decisões por tema" com o token que a conta já tem é a **API v1 de jurisprudência**:

| Rota v1 | Uso |
|---|---|
| `GET /api/v1/jurisprudencias` | lista os filtros aceitos (inclui tribunais) |
| `GET /api/v1/jurisprudencias/busca?q=<termo>&pagina=&de_data=&ate_data=` | busca paginada por termo |
| `GET /api/v1/jurisprudencias/documento/{tipo}/{id}` | inteiro teor de 1 decisão |

Valores, tempo e advogados **não vêm estruturados** — vêm no texto da ementa/acórdão. Por isso há uma etapa de extração via LLM.

## Componentes entregues

1. **Edge function `search-jurisprudencia`** — busca por assunto (v1). Ações: `filtros`, `buscar`, `documento`.
2. **Edge function `extract-jurimetria`** — recebe decisões e extrai `resultado`, `valor_condenacao`, `valor_danos_morais`, `nulidade_apostas`, `relator`, `advogados[]` via Gemini (mesmo padrão de `analyze-legal-viability`).
3. **Migration `20260730120000_jurimetria_ludopatia.sql`** — tabela `jurimetria_ludopatia` (corpus, com RLS) + views:
   - `vw_jurimetria_ludopatia_resumo` — por tribunal: taxa de êxito, média/mediana de condenação, média de danos morais, tempo médio.
   - `vw_jurimetria_ludopatia_advogados` — ranking de advogados por volume.

## Como colocar pra rodar (precisa da sua confirmação)

Nada disso foi deployado/aplicado ainda. Os passos:

```bash
# 1. Aplicar a migration (cria tabela + views no projeto Cloud gliigkupoebmlbwyvijp)
supabase db push        # ou aplicar 20260730120000_jurimetria_ludopatia.sql

# 2. Deploy das edge functions
supabase functions deploy search-jurisprudencia
supabase functions deploy extract-jurimetria
# ESCAVADOR_API_TOKEN e GOOGLE_AI_API_KEY já são secrets existentes — nada novo a configurar.
```

## Fluxo de coleta (orquestração)

```
1. search-jurisprudencia  action=buscar  termo="ludopatia"            -> páginas
   (repetir com termos: "Lei das Bets", "art. 26 Lei 14.790",
    "nulidade aposta vício", "jogo patológico apostas")
2. para cada decisão: search-jurisprudencia action=documento          -> inteiro teor (se precisar)
3. extract-jurimetria     decisoes=[...]  (lotes de até 50)           -> campos estruturados
4. upsert em jurimetria_ludopatia (service_role)
5. consultar vw_jurimetria_ludopatia_resumo / _advogados
```

Exemplo de chamada de busca:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/search-jurisprudencia" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"buscar","termo":"ludopatia","pagina":1}'
```

## Custos (ordem de grandeza)

- **Escavador**: cada busca de jurisprudência e cada inteiro teor consomem créditos da conta (consultar plano). Paginar 5 termos × N páginas multiplica.
- **Gemini (extração)**: ~1 chamada `gemini-2.5-flash` por decisão. Centenas de decisões = alguns milhares de tokens cada → custo baixo, mas visível se rodar em milhares.

## Ressalva importante (validade da jurimetria)

O tema é **novíssimo**: Lei 14.790/2023 e o acórdão-líder do TJDFT (Acórdão 2127370, proc. `0707743-74.2025.8.07.0001`, Des. Roberto Freitas Filho, 3ª T. Cível, jul. 27/05/2026) é de **maio/2026**. A maioria dos casos ainda está em 1º grau, sem trânsito em julgado.

Consequência: **tempo médio de tramitação** e **valor médio de condenação** terão amostra pequena e imatura no começo. As views já expõem `total_decisoes`, `primeira_decisao` e `ultima_decisao` — **sempre olhar o N antes de tratar a média como tendência**. Com N baixo, use mediana e reporte o intervalo, não só a média.

## Reversão

- Migration: `DROP VIEW vw_jurimetria_ludopatia_resumo, vw_jurimetria_ludopatia_advogados; DROP TABLE jurimetria_ludopatia;`
- Edge functions: `supabase functions delete search-jurisprudencia extract-jurimetria` + remover entradas do `config.toml`.
