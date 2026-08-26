-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 25/08/2026. "Confirmo que e corrigir" — Raym.
-- ============================================================================
-- NAO NASCE DECISAO NOVA. A decisao de 10/04/2024 continua sendo a mesma; ela
-- so foi LIDA errado da primeira vez, a partir da homologacao publica, que nao
-- abre valor por parte. Criar decisao nova fingiria que houve novo julgamento.
--
-- Isso convive com a regra do valor vigente ("vale a ultima decisao de cada
-- parte", ditada em 20/08): aquela regra e para APURACAO nova. Aqui e a mesma
-- apuracao, com o numero certo.
--
-- O RASTRO E OBRIGATORIO. Corrigir sem guardar o anterior apaga a prova de que
-- houve erro — e num modulo que decide quanto vale a carteira, isso e
-- inaceitavel:
--
--   dano_moral_anterior      o que estava la
--   dano_estetico_anterior   idem
--   corrigido_em             quando
--   corrigido_por_leitura    de qual leitura, e dali ate o PDF
--
-- POR QUE RPC E NAO UPDATE DIRETO DO FRONT
--
--   A funcao calcula os valores DA PROPRIA LEITURA. O front nao manda numero
--   nenhum — so diz qual peca corrige qual decisao. Um UPDATE direto exigiria
--   conceder escrita nas colunas de valor, e af qualquer sessao (inclusive a
--   anonima, ver acesso-externo-sessao-anonima.md) poderia escrever o valor que
--   quisesse na carteira.
--
-- A TRAVA DE PROCESSO: a peca so corrige decisao DO MESMO CNJ. Sem isso, um
-- dec_id errado vindo da tela reescreveria valor de outro caso, e ninguem
-- notaria.
--
-- `p_simular` default TRUE: quem chama sem pensar nao grava nada.
--
-- PROVADO com o caso 88 antes de liberar. Simulacao com a leitura 275 (termo de
-- acordo) contra a decisao D0307 (homologacao de 10/04/2024): 5 de 5 partes
-- casadas, zero sem par, e os valores saindo de 7.792,21 / 3.896,10 para
-- 113.636,36 / 56.818,18 — o que o termo diz, ao centavo.
--
-- REVERSAO:
--   drop function if exists public.jm_corrigir_valores_da_leitura(bigint,text,boolean);
--   drop function if exists public.jm_nome_norm(text);
--   alter table public.jm_valores drop column if exists dano_moral_anterior,
--     drop column if exists dano_estetico_anterior, drop column if exists corrigido_em,
--     drop column if exists corrigido_por_leitura;
--   -- desfazer uma correcao ja aplicada:
--   -- update jm_valores set dano_moral = dano_moral_anterior,
--   --   dano_estetico = dano_estetico_anterior, corrigido_em = null,
--   --   corrigido_por_leitura = null where corrigido_por_leitura = <id>;
-- ============================================================================

alter table public.jm_valores
  add column if not exists dano_moral_anterior    numeric,
  add column if not exists dano_estetico_anterior numeric,
  add column if not exists corrigido_em           timestamptz,
  add column if not exists corrigido_por_leitura  bigint;

comment on column public.jm_valores.dano_moral_anterior is
  'O valor que estava aqui antes da correção pela peça. Corrigir sem guardar o anterior é apagar a prova de que houve erro.';
comment on column public.jm_valores.corrigido_por_leitura is
  'jm_documento_leitura.id que corrigiu esta linha. Permite refazer o caminho até o PDF.';

-- Sem acento e em caixa alta: a peça escreve "JOAO", a carteira "JOÃO".
-- translate em vez da extensão unaccent, que não está instalada neste projeto.
create or replace function public.jm_nome_norm(p text)
returns text language sql immutable as $$
  select upper(translate(coalesce(p,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;

-- (corpo de jm_corrigir_valores_da_leitura aplicado via MCP; ver a definição
--  vigente com \sf public.jm_corrigir_valores_da_leitura)
