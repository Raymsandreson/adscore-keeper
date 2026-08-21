-- =============================================================================
-- O motivo pelo qual os autos falharam some — e ele custa R$ 1,50.
--
-- MEDIDO EM 21/08/2026: treze processos foram disparados com
-- {autos:1, utilizar_certificado:1}, a 150 creditos (R$ 1,50) cada, logo depois
-- de o TOTP do PDPJ ser cadastrado no certificado 302. Onze concluiram no
-- Escavador: 5 LOGIN_ERROR, 4 SECRET_ERROR, 1 INTERNAL_ERROR, zero SUCESSO.
-- No nosso banco as treze linhas ficaram `SUCESSO / PUBLICOS`, motivo_erro
-- vazio. R$ 19,50 gastos, nenhum auto restrito, e nenhuma pista do porque.
--
-- Sao dois apagadores, os dois na edge esc-autos:
--   1. `acao=autos` so trata ultima_verificacao.status = 'PENDENTE'. Com
--      status='ERRO' ela segue e chama GET /autos, que responde um 422
--      generico — o SECRET_ERROR fica so na API do Escavador.
--   2. ao concluir a colheita ela grava `motivo_erro = null`, e a colheita que
--      conclui e a PUBLICA, feita depois do rebaixamento.
--
-- autos_erro fica FORA de motivo_erro de proposito: motivo_erro e do ciclo
-- corrente e e zerado a cada SUCESSO; autos_erro e o historico da tentativa
-- cara, e sobrevive ao rebaixamento.
--
-- Colunas novas e nullable: nada que le a tabela hoje muda de comportamento.
-- REVERSAO (imediata, sem perda de dado vivo):
--   alter table public.jm_esc_solicitacoes
--     drop column autos_erro, drop column autos_tentado_em;
-- =============================================================================
alter table public.jm_esc_solicitacoes
  add column if not exists autos_erro       text,
  add column if not exists autos_tentado_em timestamptz;

comment on column public.jm_esc_solicitacoes.autos_erro is
  'motivo_erro do Escavador na ultima tentativa com autos+certificado (LOGIN_ERROR, SECRET_ERROR, INTERNAL_ERROR...). Nao e zerado pelo SUCESSO da colheita publica que vem depois do rebaixamento.';

comment on column public.jm_esc_solicitacoes.autos_tentado_em is
  'quando a tentativa com certificado foi avaliada. Com autos_erro null e esta coluna preenchida, os autos vieram.';
