-- Avisar quem indicou quando o caso do indicado deu certo.
--
-- BANCO: Supabase EXTERNO (kmedldlepwiityjsdahz), onde moram `referrals`,
-- `leads`, `inss_admin_processes` e `process_movements`. Não aplicar no Cloud.
--
-- (A migration original da `referrals` — 20260911141500 — foi parar em
-- `supabase/migrations/` por engano; a tabela sempre foi do Externo. Esta vai
-- na pasta certa. Nada a corrigir na anterior: pasta não muda o que já rodou.)
--
-- ============================================================================
-- POR QUE ISTO EXISTE
-- ============================================================================
-- Quem indica alguém nunca descobre o que aconteceu. Passa o contato do
-- cunhado, o cunhado consegue o BPC/LOAS seis meses depois, e o indicador
-- segue sem saber. A indicação morre ali — e a pessoa que mais confia no
-- escritório é justamente quem nunca recebe notícia de que a confiança valeu.
--
-- Fechar esse laço é a coisa mais barata que existe: a notícia boa já está no
-- banco, só não chega a quem a provocou.
--
-- ============================================================================
-- O ELO QUE FALTAVA
-- ============================================================================
-- A `referrals` guardava o telefone do indicado, mas NUNCA o lead que ele virou.
-- Sem isso não há como perguntar "o caso dele deu certo?". Medido em 15/09/2026
-- (base viva: subiu de 1.416 para 1.437 indicações durante a própria medição):
--   * 1.437 indicações, quase todas ainda em `status='novo'` — a esteira de
--     apresentação nunca andou. O laço de volta não depende dela.
--   * 173 indicações casam com um lead: 141 pelo telefone (últimos 8 dígitos, o
--     mesmo critério de `leads.phone_match_key`) e 97 por `contact_leads`, com
--     sobreposição. 3 casam com MAIS DE UM lead pelo telefone.
--   * Desfechos já existentes hoje: 6 com INSS deferido, 1 com acordo ou
--     pagamento, 1 com sentença (esta vai para revisão humana).
--
-- POR QUE `contact_leads` VEM ANTES DO TELEFONE: os 6 deferimentos aparecem
-- EXCLUSIVAMENTE por `contact_leads`. Pelo telefone sozinho seriam ZERO — a
-- medição feita só com os 8 dígitos dizia que a funcionalidade não dispararia
-- nenhuma vez, e estava errada. O elo explícito enxerga o que o telefone não
-- enxerga (cadastro com número antigo, cliente que trocou de chip).
--
-- ============================================================================
-- CONSENTIMENTO — POR QUE NÃO É OPCIONAL
-- ============================================================================
-- "O Zé que você indicou conseguiu o BPC" conta a um terceiro que o Zé é
-- cliente, que tem um caso e qual foi o desfecho. Benefício assistencial é dado
-- de saúde e de renda (LGPD art. 5º, II) e a relação cliente-escritório é
-- coberta por sigilo profissional. Nada disso sai sem o "pode contar" do
-- próprio Zé, registrado com data.
--
-- Silêncio NÃO é consentimento: pedido sem resposta expira em CONSENT_VALIDADE
-- dias e o aviso nunca sai. É o inverso do padrão de marketing, e é de propósito.
--
-- ============================================================================
-- ROLLBACK (<1min, nada existente é alterado)
-- ============================================================================
--   ALTER TABLE public.referrals
--     DROP COLUMN converted_lead_id, DROP COLUMN converted_case_id,
--     DROP COLUMN converted_at,      DROP COLUMN match_method,
--     DROP COLUMN match_confidence,  DROP COLUMN match_attempted_at,
--     DROP COLUMN success_kind,
--     DROP COLUMN success_label,     DROP COLUMN success_ref,
--     DROP COLUMN success_at,        DROP COLUMN success_detected_at,
--     DROP COLUMN success_scanned_at,
--     DROP COLUMN consent_status,    DROP COLUMN consent_asked_at,
--     DROP COLUMN consent_answered_at, DROP COLUMN consent_message_id,
--     DROP COLUMN consent_reply_text, DROP COLUMN thanks_status,
--     DROP COLUMN thanks_texto,      DROP COLUMN thanks_enviado_at,
--     DROP COLUMN thanks_message_id, DROP COLUMN thanks_erro,
--     DROP COLUMN thanks_grupo_id;
-- ============================================================================

-- ===== ELO: a indicação virou qual lead? =====
ALTER TABLE public.referrals
  -- Lead do Externo que o indicado virou. Sem FK por opção: `leads` é limpa e
  -- fundida (MergeDuplicates) e a indicação, que é o registro histórico, não
  -- pode sumir junto. O scan reconcilia sozinho na rodada seguinte.
  ADD COLUMN IF NOT EXISTS converted_lead_id uuid,
  ADD COLUMN IF NOT EXISTS converted_case_id uuid,
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  -- 'phone8'    → últimos 8 dígitos batem com leads.phone_match_key
  -- 'contact_id'→ veio por indicated_contact_id → contact_leads
  -- 'manual'    → alguém ligou na tela
  ADD COLUMN IF NOT EXISTS match_method text,
  -- 'alta'    → exatamente 1 lead casou. Só esta libera aviso automático.
  -- 'ambigua' → mais de um lead casou (3 casos hoje). Fica para conferência
  --             humana: avisar o indicador sobre o desfecho da PESSOA ERRADA é
  --             pior que não avisar.
  ADD COLUMN IF NOT EXISTS match_confidence text,
  -- Rodízio da varredura. Carimbada em TODA tentativa, casando ou não.
  --
  -- Sem ela o scan pegava as N mais novas sem lead — e como "não casou" deixa
  -- `converted_lead_id` nulo, as mesmas N voltavam à fila em toda rodada e as
  -- mais antigas nunca eram olhadas. Medido antes do conserto: os 6
  -- deferimentos que existem hoje estavam TODOS na faixa faminta. A
  -- funcionalidade rodaria para sempre sem achar nada, e o sintoma seria
  -- indistinguível de "não há nada para avisar".
  --
  -- Ordenar por ela com NULLS FIRST põe quem nunca foi tentado na frente; quem
  -- não casou hoje volta para o fim e é tentado de novo depois — que é o
  -- comportamento certo, porque o indicado pode virar lead amanhã.
  ADD COLUMN IF NOT EXISTS match_attempted_at timestamptz;

-- ===== DESFECHO: o caso do indicado deu certo? =====
ALTER TABLE public.referrals
  -- 'inss_deferido' | 'acordo' | 'pagamento' | 'sentenca_revisar'
  ADD COLUMN IF NOT EXISTS success_kind text,
  -- Frase curta e humana ("o benefício saiu"). O que a mensagem usa.
  ADD COLUMN IF NOT EXISTS success_label text,
  -- id da linha que provou o desfecho (inss_admin_processes ou
  -- process_movements). Auditoria: dá para voltar na origem e conferir.
  ADD COLUMN IF NOT EXISTS success_ref text,
  -- Data do fato (deferimento, acordo, alvará) — não a data em que varremos.
  ADD COLUMN IF NOT EXISTS success_at date,
  ADD COLUMN IF NOT EXISTS success_detected_at timestamptz,
  -- Rodízio da busca de desfecho, mesmo papel de `match_attempted_at`. Esta
  -- fila CRESCE e nunca esvazia — indicado cujo caso nunca ganha fica nela para
  -- sempre —, então um top-N sobre ordem fixa pararia de olhar as mais antigas
  -- assim que passasse do teto, em silêncio e meses depois.
  ADD COLUMN IF NOT EXISTS success_scanned_at timestamptz;

-- ===== CONSENTIMENTO DO INDICADO =====
ALTER TABLE public.referrals
  -- null | 'pedido' | 'sim' | 'nao' | 'expirado' | 'dispensado'
  --   'dispensado' = a tela optou por avisar sem identificar ninguém.
  ADD COLUMN IF NOT EXISTS consent_status text,
  ADD COLUMN IF NOT EXISTS consent_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_message_id text,
  -- A resposta crua, para auditoria de uma classificação de IA que errou.
  -- É a frase do cliente sobre a própria privacidade — fica no mesmo banco,
  -- mesma região, mesma RLS de `referrals`, e nunca vai para log.
  ADD COLUMN IF NOT EXISTS consent_reply_text text;

-- ===== AVISO A QUEM INDICOU =====
ALTER TABLE public.referrals
  -- null | 'revisar' | 'agendado' | 'enviado' | 'erro' | 'bloqueado'
  --   'revisar'   → desfecho existe mas não é inequívoco (sentença), ou o
  --                 casamento com o lead é ambíguo. Fila humana, nunca auto.
  --   'agendado'  → consentimento dado; espera a janela de 8h–20h.
  --   'bloqueado' → indicador já recebeu aviso nos últimos 30 dias.
  ADD COLUMN IF NOT EXISTS thanks_status text,
  ADD COLUMN IF NOT EXISTS thanks_texto text,
  ADD COLUMN IF NOT EXISTS thanks_enviado_at timestamptz,
  ADD COLUMN IF NOT EXISTS thanks_message_id text,
  ADD COLUMN IF NOT EXISTS thanks_erro text,
  -- Se o cartão veio de grupo, guardamos o grupo só para rastreio. O aviso vai
  -- para `referrer_sender_phone`, no privado, SEMPRE. Mandar "o Zé conseguiu o
  -- BPC" num grupo de 200 pessoas é vazamento, mesmo com o consentimento do Zé:
  -- ele autorizou contar a QUEM O INDICOU, não ao grupo inteiro.
  -- Medido em 15/09/2026: 997 de 1.416 indicações vieram de grupo, e TODAS as
  -- 997 têm `referrer_sender_phone` preenchido — o privado sempre existe.
  ADD COLUMN IF NOT EXISTS thanks_grupo_id text;

-- ===== ÍNDICES =====
-- O rodízio da busca de desfecho: quem nunca foi varrido primeiro.
CREATE INDEX IF NOT EXISTS idx_referrals_rodizio_de_desfecho
  ON public.referrals (success_scanned_at NULLS FIRST)
  WHERE converted_lead_id IS NOT NULL AND success_detected_at IS NULL;

-- O rodízio do casamento: quem nunca foi tentado primeiro, depois o mais antigo
-- de tentativa. Ordenar por `shared_at` aqui era o que causava a inanição.
CREATE INDEX IF NOT EXISTS idx_referrals_rodizio_de_casamento
  ON public.referrals (match_attempted_at NULLS FIRST, shared_at DESC)
  WHERE converted_lead_id IS NULL;

-- O dispatch varre a fila de aviso e a fila de consentimento pendente.
CREATE INDEX IF NOT EXISTS idx_referrals_fila_de_aviso
  ON public.referrals (thanks_status, success_detected_at DESC)
  WHERE thanks_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_consentimento_pendente
  ON public.referrals (consent_asked_at)
  WHERE consent_status = 'pedido';

-- Trava de 30 dias por indicador: "esse indicador já recebeu aviso?" é uma
-- busca por telefone + data de envio.
CREATE INDEX IF NOT EXISTS idx_referrals_aviso_por_indicador
  ON public.referrals (referrer_phone, thanks_enviado_at DESC)
  WHERE thanks_enviado_at IS NOT NULL;

COMMENT ON COLUMN public.referrals.converted_lead_id IS
  'Lead (Externo) que o indicado virou. Elo que permite perguntar se o caso dele deu certo.';
COMMENT ON COLUMN public.referrals.consent_status IS
  'Autorização do INDICADO para contar ao indicador que deu certo. Silêncio expira, nunca autoriza.';
COMMENT ON COLUMN public.referrals.thanks_status IS
  'Fila do aviso a quem indicou. revisar=humano decide; agendado=espera janela 8h-20h.';
