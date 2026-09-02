-- =============================================================================
-- Objetivos e passos para os marcos que ficaram sem nenhum (02/09/2026)
--
-- Pedido do usuário: "os marcos sem objetivos preencha conforme as boas
-- práticas que um escritório deve ter — cada objetivo e passo para passar de
-- um marco para outro".
--
-- Depois de 20260902160000 (só marcos, sem fases), 13 marcos do BPC não tinham
-- objetivo e o objetivo "Definição da Estratégia" do trabalhista estava com
-- zero passos. Cada objetivo abaixo é o que precisa estar feito para o
-- processo poder sair daquele marco: conferir a decisão, agir no prazo,
-- comunicar o cliente e atualizar o recebível (vocabulário do fluxo de caixa:
-- CONDENAÇÃO → A RECEBER → PAGO).
--
-- Formato dos passos = o mesmo dos templates existentes (id, label,
-- description, activityType, docChecklist[{id,type,label}], prazoValor,
-- prazoUnidade). Tipos de item: verificacao | documentos | requisitos | outro.
--
-- Idempotente: só insere o template se não existir link para o marco.
-- Rollback: delete dos templates criados aqui (name in ... e board via link).
-- =============================================================================

with novos(stage_id, nome, descricao, items) as (values
  ('m_analise_administrativa', 'Acompanhamento da análise no INSS',
   'Requerimento protocolado e em análise: acompanhar, cumprir exigência e preparar o cliente para perícia e avaliação social.',
   $j$[
     {"id":"bpc_an_1","label":"Acompanhar o requerimento no Meu INSS","description":"Conferir o status do requerimento e anotar agendamentos de perícia médica e avaliação social.","activityType":"Acompanhamento","prazoValor":7,"prazoUnidade":"dias","docChecklist":[{"id":"bpc_an_1_a","type":"verificacao","label":"Status conferido no Meu INSS"},{"id":"bpc_an_1_b","type":"verificacao","label":"Perícia / avaliação social agendada: data e local anotados"}]},
     {"id":"bpc_an_2","label":"Cumprir exigência do INSS no prazo","description":"Exigência tem 30 dias; perder o prazo encerra o requerimento.","activityType":"Acompanhamento","prazoValor":30,"prazoUnidade":"dias","docChecklist":[{"id":"bpc_an_2_a","type":"documentos","label":"Documento exigido anexado ao requerimento"},{"id":"bpc_an_2_b","type":"verificacao","label":"Protocolo do cumprimento salvo no sistema"}]},
     {"id":"bpc_an_3","label":"Preparar o cliente para a perícia e a avaliação social","description":"Cliente avisado, com laudos e exames atualizados em mãos.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_an_3_a","type":"verificacao","label":"Cliente avisado de data, local e documentos"},{"id":"bpc_an_3_b","type":"documentos","label":"Laudos, exames e receitas atualizados entregues"}]},
     {"id":"bpc_an_4","label":"Registrar o resultado e mover o marco","description":"Concessão → marco Benefício concedido; indeferimento → marco Indeferimento do INSS (30 dias para recurso administrativo ou ação).","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_an_4_a","type":"verificacao","label":"Resultado registrado com a data da decisão"},{"id":"bpc_an_4_b","type":"outro","label":"Cliente comunicado do resultado"}]}
   ]$j$),

  ('m_concessao_administrativa', 'Concessão administrativa e encerramento',
   'Benefício concedido pelo INSS: conferir a carta, orientar o pagamento, fechar honorários e encerrar.',
   $j$[
     {"id":"bpc_co_1","label":"Conferir a carta de concessão","description":"DIB, valor e atrasados conforme a DER.","activityType":"Acompanhamento","prazoValor":3,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_co_1_a","type":"verificacao","label":"DIB igual à DER?"},{"id":"bpc_co_1_b","type":"verificacao","label":"Valor e forma de pagamento conferidos"},{"id":"bpc_co_1_c","type":"verificacao","label":"Atrasados desde a DER calculados"}]},
     {"id":"bpc_co_2","label":"Comunicar o cliente e orientar o pagamento","description":"Banco, agência e data do primeiro pagamento.","activityType":"NOTIFICAÇÃO EMAIL","docChecklist":[{"id":"bpc_co_2_a","type":"requisitos","label":"Cliente comunicado da concessão"},{"id":"bpc_co_2_b","type":"verificacao","label":"Data do primeiro pagamento anotada"}]},
     {"id":"bpc_co_3","label":"Honorários e recebível","description":"Contrato conferido e recebível registrado (cota do cliente × honorário).","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_co_3_a","type":"verificacao","label":"Contrato de honorários conferido"},{"id":"bpc_co_3_b","type":"verificacao","label":"Recebível registrado e estágio financeiro atualizado"}]},
     {"id":"bpc_co_4","label":"Encerrar o requerimento e orientar a manutenção","description":"Revisão bienal do BPC e CadÚnico em dia.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_co_4_a","type":"outro","label":"Cliente orientado sobre revisão bienal e atualização do CadÚnico"}]}
   ]$j$),

  ('m_audiencia_instrucao', 'Audiência de instrução',
   'Intimação conferida, cliente e testemunhas preparados, ata registrada e providências pós-audiência.',
   $j$[
     {"id":"bpc_ai_1","label":"Conferir a intimação: data, hora e formato","description":"Presencial ou virtual; rol de testemunhas no prazo.","activityType":"Acompanhamento","prazoValor":2,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_ai_1_a","type":"verificacao","label":"Data, hora e link/local anotados na agenda"},{"id":"bpc_ai_1_b","type":"verificacao","label":"Rol de testemunhas protocolado no prazo"}]},
     {"id":"bpc_ai_2","label":"Preparar o cliente e as testemunhas","description":"Reunião de preparação e documentos originais separados.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_ai_2_a","type":"verificacao","label":"Reunião de preparação realizada"},{"id":"bpc_ai_2_b","type":"documentos","label":"Documentos originais separados"}]},
     {"id":"bpc_ai_3","label":"Participar da audiência e registrar a ata","description":"Ata juntada e prazos fixados anotados.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_ai_3_a","type":"documentos","label":"Ata juntada ao processo no sistema"},{"id":"bpc_ai_3_b","type":"verificacao","label":"Prazos fixados na ata anotados (razões finais, diligências)"}]},
     {"id":"bpc_ai_4","label":"Providências pós-audiência","description":"Razões finais/memoriais e comunicação ao cliente.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_ai_4_a","type":"verificacao","label":"Razões finais protocoladas, se determinado"},{"id":"bpc_ai_4_b","type":"outro","label":"Cliente informado do que aconteceu na audiência"}]}
   ]$j$),

  ('m_replica', 'Réplica à contestação',
   'Contestação analisada, réplica protocolada em 15 dias úteis e provas requeridas.',
   $j$[
     {"id":"bpc_re_1","label":"Analisar a contestação do INSS","description":"Preliminares, prescrição e teses de mérito.","activityType":"Acompanhamento","prazoValor":5,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_re_1_a","type":"verificacao","label":"Preliminares e prescrição identificadas"},{"id":"bpc_re_1_b","type":"verificacao","label":"Teses de mérito e provas requeridas pelo INSS anotadas"}]},
     {"id":"bpc_re_2","label":"Protocolar a réplica","description":"Rebater preliminares e requerer as provas (perícia médica, estudo social, testemunhas).","activityType":"Acompanhamento","prazoValor":15,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_re_2_a","type":"documentos","label":"Réplica protocolada e juntada ao sistema"},{"id":"bpc_re_2_b","type":"verificacao","label":"Provas requeridas expressamente"}]},
     {"id":"bpc_re_3","label":"Acompanhar a decisão sobre as provas","description":"Despacho saneador / designação de perícia.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_re_3_a","type":"verificacao","label":"Despacho conferido e prazos anotados"}]}
   ]$j$),

  ('m_embargos_1grau', 'Embargos de declaração (1º grau)',
   'Cabimento analisado em 5 dias úteis, peça protocolada e julgamento acompanhado.',
   $j$[
     {"id":"bpc_e1_1","label":"Analisar o cabimento dos embargos","description":"Omissão, contradição, obscuridade ou erro material.","activityType":"Acompanhamento","prazoValor":5,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_e1_1_a","type":"verificacao","label":"Vício identificado (ou decisão fundamentada de não embargar)"}]},
     {"id":"bpc_e1_2","label":"Protocolar embargos ou contrarrazões","description":"Prazo de 5 dias úteis.","activityType":"Acompanhamento","prazoValor":5,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_e1_2_a","type":"documentos","label":"Peça protocolada e juntada ao sistema"}]},
     {"id":"bpc_e1_3","label":"Acompanhar o julgamento dos embargos","description":"Prazo recursal recontado a partir da decisão.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_e1_3_a","type":"verificacao","label":"Decisão lida e prazo de apelação recontado"},{"id":"bpc_e1_3_b","type":"outro","label":"Cliente informado"}]}
   ]$j$),

  ('m_acordao_2grau', 'Acórdão (2º grau)',
   'Acórdão lido, recurso avaliado em 15 dias úteis, cliente comunicado e recebível atualizado.',
   $j$[
     {"id":"bpc_ac_1","label":"Ler o acórdão e conferir o dispositivo","description":"Provimento, DIB/RMI, juros e correção, tutela.","activityType":"Acompanhamento","prazoValor":3,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_ac_1_a","type":"verificacao","label":"Provido / improvido / parcialmente provido"},{"id":"bpc_ac_1_b","type":"verificacao","label":"DIB, RMI, juros e correção mantidos ou alterados"},{"id":"bpc_ac_1_c","type":"verificacao","label":"Implantação / tutela determinada?"}]},
     {"id":"bpc_ac_2","label":"Avaliar recurso","description":"ED, REsp/RE ou pedido de uniformização (TNU): cabimento e prazo.","activityType":"Acompanhamento","prazoValor":15,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_ac_2_a","type":"verificacao","label":"Decisão de recorrer ou não registrada com o responsável"}]},
     {"id":"bpc_ac_3","label":"Comunicar o cliente e atualizar o recebível","description":"Estágio financeiro: CONDENAÇÃO / A RECEBER.","activityType":"NOTIFICAÇÃO EMAIL","docChecklist":[{"id":"bpc_ac_3_a","type":"requisitos","label":"Cliente comunicado"},{"id":"bpc_ac_3_b","type":"verificacao","label":"Estágio financeiro atualizado"}]}
   ]$j$),

  ('m_remessa_superior', 'Remessa à instância superior',
   'Admissibilidade conferida, autuação no STJ/TNU/STF acompanhada.',
   $j$[
     {"id":"bpc_rs_1","label":"Conferir a admissibilidade e a subida","description":"Recurso admitido ou não; agravo cabível?","activityType":"Acompanhamento","prazoValor":5,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_rs_1_a","type":"verificacao","label":"Decisão de admissibilidade lida; agravo avaliado"},{"id":"bpc_rs_1_b","type":"verificacao","label":"Número no tribunal superior e relator anotados"}]},
     {"id":"bpc_rs_2","label":"Acompanhar a autuação e a distribuição","description":"Consulta periódica no tribunal superior.","activityType":"Acompanhamento","prazoValor":30,"prazoUnidade":"dias","docChecklist":[{"id":"bpc_rs_2_a","type":"verificacao","label":"Andamento conferido"},{"id":"bpc_rs_2_b","type":"outro","label":"Cliente informado da fase e do tempo esperado"}]}
   ]$j$),

  ('m_decisao_superior', 'Decisão superior (STJ / TNU / STF)',
   'Decisão analisada, recurso interposto ou trânsito aguardado, cliente comunicado.',
   $j$[
     {"id":"bpc_ds_1","label":"Analisar a decisão","description":"Efeitos sobre a condenação; agravo interno / ED em 15 dias.","activityType":"Acompanhamento","prazoValor":3,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_ds_1_a","type":"verificacao","label":"Resultado e efeitos sobre a condenação anotados"},{"id":"bpc_ds_1_b","type":"verificacao","label":"Cabimento de agravo interno / ED avaliado"}]},
     {"id":"bpc_ds_2","label":"Recorrer ou aguardar o trânsito","description":"Peça protocolada ou decisão de não recorrer registrada.","activityType":"Acompanhamento","prazoValor":15,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_ds_2_a","type":"documentos","label":"Peça protocolada, se houver"},{"id":"bpc_ds_2_b","type":"verificacao","label":"Decisão de não recorrer registrada"}]},
     {"id":"bpc_ds_3","label":"Comunicar o cliente e atualizar o recebível","description":"","activityType":"NOTIFICAÇÃO EMAIL","docChecklist":[{"id":"bpc_ds_3_a","type":"requisitos","label":"Cliente comunicado"},{"id":"bpc_ds_3_b","type":"verificacao","label":"Estágio financeiro atualizado"}]}
   ]$j$),

  ('m_transito_julgado', 'Trânsito em julgado',
   'Trânsito certificado, cumprimento/implantação requeridos e recebível em A RECEBER.',
   $j$[
     {"id":"bpc_tj_1","label":"Certificar o trânsito em julgado","description":"","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_tj_1_a","type":"documentos","label":"Certidão de trânsito juntada ao sistema"},{"id":"bpc_tj_1_b","type":"verificacao","label":"Data do trânsito registrada"}]},
     {"id":"bpc_tj_2","label":"Requerer o cumprimento de sentença e a implantação","description":"","activityType":"Acompanhamento","prazoValor":10,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_tj_2_a","type":"documentos","label":"Petição de cumprimento protocolada"},{"id":"bpc_tj_2_b","type":"verificacao","label":"Ofício de implantação requerido"}]},
     {"id":"bpc_tj_3","label":"Atualizar o recebível","description":"Estágio A RECEBER com valor estimado atualizado.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_tj_3_a","type":"verificacao","label":"Estágio A RECEBER e valor estimado registrados"},{"id":"bpc_tj_3_b","type":"outro","label":"Cliente informado do próximo passo (cálculos)"}]}
   ]$j$),

  ('m_liquidacao_calculos', 'Liquidação / cálculos',
   'Cálculos conferidos conforme o título, apresentados ou impugnados, e homologação acompanhada.',
   $j$[
     {"id":"bpc_lq_1","label":"Elaborar ou conferir os cálculos","description":"RMI, DIB, DIP, atrasados, juros e correção conforme o título; honorários destacados.","activityType":"Acompanhamento","prazoValor":15,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_lq_1_a","type":"verificacao","label":"Parâmetros do título conferidos"},{"id":"bpc_lq_1_b","type":"verificacao","label":"Honorários contratuais destacados e sucumbenciais separados"}]},
     {"id":"bpc_lq_2","label":"Apresentar os cálculos ou impugnar os do INSS","description":"","activityType":"Acompanhamento","prazoValor":15,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_lq_2_a","type":"documentos","label":"Planilha protocolada e juntada ao sistema"}]},
     {"id":"bpc_lq_3","label":"Acompanhar a homologação","description":"","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_lq_3_a","type":"verificacao","label":"Valor homologado registrado no recebível (cota do cliente × honorário)"}]}
   ]$j$),

  ('m_implantacao_beneficio', 'Implantação do benefício',
   'Ofício acompanhado, implantação conferida no Meu INSS e cliente comunicado.',
   $j$[
     {"id":"bpc_im_1","label":"Acompanhar o ofício de implantação","description":"CEAB / APSDJ; cobrar se passar do prazo.","activityType":"Acompanhamento","prazoValor":45,"prazoUnidade":"dias","docChecklist":[{"id":"bpc_im_1_a","type":"verificacao","label":"Ofício expedido e recebido pelo INSS"},{"id":"bpc_im_1_b","type":"verificacao","label":"Petição de cobrança se o prazo passou"}]},
     {"id":"bpc_im_2","label":"Conferir a implantação no Meu INSS","description":"Benefício ativo, DIP e valor.","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_im_2_a","type":"verificacao","label":"Benefício ativo, DIP e valor conferidos"},{"id":"bpc_im_2_b","type":"verificacao","label":"Divergência → petição de correção"}]},
     {"id":"bpc_im_3","label":"Comunicar o cliente","description":"Implantação e data do primeiro pagamento.","activityType":"NOTIFICAÇÃO EMAIL","docChecklist":[{"id":"bpc_im_3_a","type":"requisitos","label":"Cliente comunicado"}]}
   ]$j$),

  ('m_rpv_precatorio', 'RPV / precatório',
   'Expedição requerida, ofício requisitório conferido e depósito acompanhado.',
   $j$[
     {"id":"bpc_rp_1","label":"Requerer a expedição","description":"Principal e honorários destacados.","activityType":"Acompanhamento","prazoValor":10,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_rp_1_a","type":"documentos","label":"Petição com valores protocolada"}]},
     {"id":"bpc_rp_2","label":"Conferir a minuta / ofício requisitório","description":"RPV (até 60 salários mínimos) ou precatório.","activityType":"Acompanhamento","prazoValor":5,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_rp_2_a","type":"verificacao","label":"Valores, beneficiários e destaque de honorários corretos"},{"id":"bpc_rp_2_b","type":"verificacao","label":"RPV ou precatório: previsão de pagamento anotada"}]},
     {"id":"bpc_rp_3","label":"Acompanhar o depósito","description":"","activityType":"Acompanhamento","docChecklist":[{"id":"bpc_rp_3_a","type":"verificacao","label":"Depósito confirmado no tribunal (data)"},{"id":"bpc_rp_3_b","type":"outro","label":"Cliente informado da previsão"}]}
   ]$j$),

  ('m_alvara_expedido', 'Alvará expedido',
   'Alvará conferido, valores levantados e prestação de contas ao cliente.',
   $j$[
     {"id":"bpc_al_1","label":"Conferir o alvará","description":"Beneficiário, valor e banco; alvará do cliente × alvará dos honorários.","activityType":"Acompanhamento","prazoValor":2,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_al_1_a","type":"verificacao","label":"Beneficiário, valor e banco corretos"},{"id":"bpc_al_1_b","type":"verificacao","label":"Alvará do cliente e dos honorários separados"}]},
     {"id":"bpc_al_2","label":"Levantar os valores","description":"","activityType":"Acompanhamento","prazoValor":5,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"bpc_al_2_a","type":"documentos","label":"Comprovante de levantamento juntado"}]},
     {"id":"bpc_al_3","label":"Prestar contas ao cliente","description":"Recebível marcado como PAGO.","activityType":"NOTIFICAÇÃO EMAIL","docChecklist":[{"id":"bpc_al_3_a","type":"documentos","label":"Recibo / prestação de contas assinada"},{"id":"bpc_al_3_b","type":"verificacao","label":"Recebível marcado como PAGO"}]}
   ]$j$)
),
inseridos as (
  insert into public.checklist_templates (name, description, is_mandatory, items, scope)
  select n.nome, n.descricao, false, n.items::jsonb, 'processo'
  from novos n
  where not exists (
    select 1 from public.checklist_stage_links l
    where l.board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6' and l.stage_id = n.stage_id
  )
  returning id, name
)
insert into public.checklist_stage_links (checklist_template_id, board_id, stage_id, display_order)
select i.id, '8377ee1b-97a2-4777-9b51-3af9e630b3c6', n.stage_id, 0
from inseridos i join novos n on n.nome = i.name;

-- Trabalhista: "Definição da Estratégia" estava com zero passos.
update public.checklist_templates
   set items = $j$[
     {"id":"trab_est_1","label":"Definir teses, pedidos e provas","description":"Cada pedido com fundamento e a prova que o sustenta; prescrição bienal e quinquenal conferidas.","activityType":"GERENCIAR TRABALHISTA","prazoValor":5,"prazoUnidade":"dias_uteis","docChecklist":[{"id":"trab_est_1_a","type":"verificacao","label":"Pedidos listados com fundamento e prova"},{"id":"trab_est_1_b","type":"verificacao","label":"Prescrição bienal e quinquenal conferidas"}]},
     {"id":"trab_est_2","label":"Estimar o valor da causa e os honorários","description":"Planilha por pedido; contrato de honorários assinado.","activityType":"GERENCIAR TRABALHISTA","docChecklist":[{"id":"trab_est_2_a","type":"documentos","label":"Planilha de estimativa por pedido"},{"id":"trab_est_2_b","type":"documentos","label":"Contrato de honorários assinado"}]},
     {"id":"trab_est_3","label":"Aprovar a estratégia com o cliente","description":"Riscos, prazos e custos explicados; decisão registrada no caso.","activityType":"GERENCIAR TRABALHISTA","docChecklist":[{"id":"trab_est_3_a","type":"requisitos","label":"Cliente ciente dos riscos, prazos e custos"},{"id":"trab_est_3_b","type":"outro","label":"Estratégia registrada no caso"}]}
   ]$j$::jsonb,
       updated_at = now()
 where id = '2a24b8f7-e654-46b8-832b-832d17daa1b9'
   and jsonb_array_length(coalesce(items, '[]'::jsonb)) = 0;
