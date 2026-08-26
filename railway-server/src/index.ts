import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  authorizeFunctionRequest,
  AUTH_ENFORCE,
  LOOPBACK_TOKEN,
  recordAuth,
  recordPublicWebhook,
  authStats,
  WEBHOOK_PUBLIC_FUNCTIONS,
} from './lib/functionAuth';
import { observeUazapiOriginAsync, uazapiOriginStats } from './lib/webhookOrigin';
// Aliases explícitos: no Railway `SUPABASE_URL` sem prefixo é o Cloud (ver
// CLOUD_FUNCTIONS_URL abaixo). Estes dois são do Externo.
import {
  SUPABASE_URL as EXTERNAL_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY as EXTERNAL_SERVICE_ROLE_KEY,
} from './lib/supabase';

dotenv.config();

// ============================================================
// REGISTRO DE HANDLERS — Adicione funções migradas aqui
// ============================================================
import { handler as whatsappWebhook } from './functions/whatsapp-webhook';
import { handler as sendTeamPush } from './functions/send-team-push';
import { handler as callQueueProcessor } from './functions/call-queue-processor';
import { handler as repairWhatsappGroup } from './functions/repair-whatsapp-group';
import { handler as zapsignWebhook } from './functions/zapsign-webhook';
import { runPostSignExtras } from './functions/zapsign-post-sign-extras';
import { handler as onboardingCheckpointExecute } from './functions/onboarding-checkpoint-execute';
import { handler as regenerateLeadName } from './functions/regenerate-lead-name';
import { handler as leadCloseSequenceInfo } from './functions/lead-close-sequence-info';
import { handler as onboardingCheckpointReprocess } from './functions/onboarding-checkpoint-reprocess';
import { handler as whatsappCloudWebhook } from './functions/whatsapp-cloud-webhook';
import { handler as whatsappGroupExit } from './functions/whatsapp-group-exit';
import { handler as whatsappDownloadMedia } from './functions/whatsapp-download-media';
import { handler as whatsappBackfillMedia } from './functions/whatsapp-backfill-media';
import { handler as extractConversationData } from './functions/extract-conversation-data';
import { handler as manageWhatsappGroupParticipants } from './functions/manage-whatsapp-group-participants';
import { handler as getGroupParticipants } from './functions/get-group-participants';
import { handler as listUazapiLabels } from './functions/list-uazapi-labels';
import { handler as manageUazapiLabel } from './functions/manage-uazapi-label';
import { handler as prepareLabelDocumentTrigger } from './functions/prepare-label-document-trigger';
import { handler as getPendingReview } from './functions/get-pending-review';
import { handler as submitDocumentReview } from './functions/submit-document-review';
import { handler as syncAgentLabels } from './functions/sync-agent-labels';
import { handler as syncResultLabels } from './functions/sync-result-labels';
import { handler as syncStageLabels } from './functions/sync-stage-labels';
import { handler as applyStageLabel } from './functions/apply-stage-label';
import { handler as applyLabelEvent } from './functions/apply-label-event';
import { handler as listStageLabelMappings } from './functions/list-stage-label-mappings';
import { handler as setStageResultKey } from './functions/set-stage-result-key';
import { handler as sendWhatsappCloud } from './functions/send-whatsapp-cloud';
import { handler as checkWhatsappCloudToken } from './functions/check-whatsapp-cloud-token';
import { handler as metaCallQueueProcessor } from './functions/meta-call-queue-processor';
import { handler as sheetLeadIngest } from './functions/sheet-lead-ingest';
import { handler as bpcSheetSync } from './functions/bpc-sheet-sync';
import { handler as syncFunnelStatusFromSheet } from './functions/sync-funnel-status-from-sheet';
import { handler as syncHearingsFromSheet } from './functions/sync-hearings-from-sheet';
import { handler as gmailInssSync } from './functions/gmail-inss-sync';
import { handler as notifyInssUpdate } from './functions/notify-inss-update';
import { handler as dispatchInssZap } from './functions/dispatch-inss-zap';
import { handler as gmailMessageBody } from './functions/gmail-message-body';
import { handler as backfillInssResultado } from './functions/backfill-inss-resultado';
import { handler as inssReport } from './functions/inss-report';
import { handler as sendEmail } from './functions/send-email';
import { handler as backfillInssExigencia } from './functions/backfill-inss-exigencia';
import { handler as matchInssOrphans } from './functions/match-inss-orphans';
import { handler as autoLinkInssByName } from './functions/auto-link-inss-by-name';
import { handler as bulkLinkInssByCpf } from './functions/bulk-link-inss-by-cpf';
import { handler as matchOrphansForLead } from './functions/match-orphans-for-lead';
import { handler as gmailProcessualSync } from './functions/gmail-processual-sync';

import { handler as getWhatsappGroupInfo } from './functions/get-whatsapp-group-info';
import { handler as scanDuplicateContacts } from './functions/scan-duplicate-contacts';
import { handler as recoverLeadsPhone55 } from './functions/recover-leads-phone-55';
import { handler as transcribeActivityCall } from './functions/transcribe-activity-call';
import { handler as transcribeTeamAudio } from './functions/transcribe-team-audio';
import { handler as suggestStepActions } from './functions/suggest-step-actions';
import { handler as suggestStepCompletion } from './functions/suggest-step-completion';
import { handler as editWorkflow } from './functions/edit-workflow';
import { handler as generateWorkflow } from './functions/generate-workflow';
import { handler as suggestRevisionReason } from './functions/suggest-revision-reason';
import { handler as wipeInstanceAgentLabels } from './functions/wipe-instance-agent-labels';
import { handler as transcodeAudioOpus } from './functions/transcode-audio-opus';
import { handler as extractActivityFromDocument } from './functions/extract-activity-from-document';
import { handler as dictateActivity } from './functions/dictate-activity';
import { handler as chatToActivity } from './functions/chat-to-activity';
import { handler as detectClientCommitments } from './functions/detect-client-commitments';
import { handler as detectGroupCaseReports } from './functions/detect-group-case-reports';
import { handler as callToActivities } from './functions/call-to-activities';
import { handler as activityFromMovement } from './functions/activity-from-movement';
import { handler as summarizeProcessUpdates } from './functions/summarize-process-updates';
import { handler as generateActivityTitle } from './functions/generate-activity-title';
import { handler as nearbyEstablishments } from './functions/nearby-establishments';
import { handler as dailyTeamReport } from './functions/daily-team-report';
import { handler as reportQuery } from './functions/report-query';
import { handler as performanceCoach } from './functions/performance-coach';
import { handler as extractAcordoFromAta } from './functions/extract-acordo-from-ata';
import { handler as jmDocumentoUrl } from './functions/jm-documento-url';
import { handler as telaoNarrar } from './functions/telao-narrar';
import { handler as celcoinOpenFinance } from './functions/celcoin-open-finance';
import { handler as updateProfileAvatar } from './functions/update-profile-avatar';



const functionHandlers: Record<string, express.RequestHandler> = {
  'whatsapp-webhook': whatsappWebhook,
  'send-team-push': sendTeamPush,
  'call-queue-processor': callQueueProcessor,
  'repair-whatsapp-group': repairWhatsappGroup,
  'zapsign-webhook': zapsignWebhook,
  'onboarding-checkpoint-execute': onboardingCheckpointExecute,
  'regenerate-lead-name': regenerateLeadName,
  'lead-close-sequence-info': leadCloseSequenceInfo,
  'onboarding-checkpoint-reprocess': onboardingCheckpointReprocess,
  'whatsapp-group-exit': whatsappGroupExit,
  'whatsapp-download-media': whatsappDownloadMedia,
  'whatsapp-backfill-media': whatsappBackfillMedia,
  'extract-conversation-data': extractConversationData,
  'manage-whatsapp-group-participants': manageWhatsappGroupParticipants,
  'get-group-participants': getGroupParticipants,
  'list-uazapi-labels': listUazapiLabels,
  'manage-uazapi-label': manageUazapiLabel,
  'prepare-label-document-trigger': prepareLabelDocumentTrigger,
  'get-pending-review': getPendingReview,
  'submit-document-review': submitDocumentReview,
  'sync-agent-labels': syncAgentLabels,
  'sync-result-labels': syncResultLabels,
  'sync-stage-labels': syncStageLabels,
  'apply-stage-label': applyStageLabel,
  'apply-label-event': applyLabelEvent,
  'list-stage-label-mappings': listStageLabelMappings,
  'set-stage-result-key': setStageResultKey,
  'send-whatsapp-cloud': sendWhatsappCloud,
  'check-whatsapp-cloud-token': checkWhatsappCloudToken,
  'meta-call-queue-processor': metaCallQueueProcessor,
  'gmail-inss-sync': gmailInssSync,
  'gmail-message-body': gmailMessageBody,
  'backfill-inss-resultado': backfillInssResultado,
  'inss-report': inssReport,
  'send-email': sendEmail,
  'backfill-inss-exigencia': backfillInssExigencia,
  'notify-inss-update': notifyInssUpdate,
  'dispatch-inss-zap': dispatchInssZap,
  'match-inss-orphans': matchInssOrphans,
  'auto-link-inss-by-name': autoLinkInssByName,
  'bulk-link-inss-by-cpf': bulkLinkInssByCpf,
  'match-orphans-for-lead': matchOrphansForLead,
  'gmail-processual-sync': gmailProcessualSync,

  'get-whatsapp-group-info': getWhatsappGroupInfo,
  'scan-duplicate-contacts': scanDuplicateContacts,
  'recover-leads-phone-55': recoverLeadsPhone55,
  'transcribe-activity-call': transcribeActivityCall,
  'transcribe-team-audio': transcribeTeamAudio,
  'suggest-step-actions': suggestStepActions,
  'suggest-step-completion': suggestStepCompletion,
  'edit-workflow': editWorkflow,
  'generate-workflow': generateWorkflow,
  'suggest-revision-reason': suggestRevisionReason,
  'wipe-instance-agent-labels': wipeInstanceAgentLabels,
  'bpc-sheet-sync': bpcSheetSync,
  'sync-funnel-status-from-sheet': syncFunnelStatusFromSheet,
  'sync-hearings-from-sheet': syncHearingsFromSheet,
  'transcode-audio-opus': transcodeAudioOpus,
  'extract-activity-from-document': extractActivityFromDocument,
  'dictate-activity': dictateActivity,
  'chat-to-activity': chatToActivity,
  'detect-client-commitments': detectClientCommitments,
  'detect-group-case-reports': detectGroupCaseReports, // IA lê grupos marcados e acha gente relatando acidente
  'call-to-activities': callToActivities,
  'activity-from-movement': activityFromMovement,
  'summarize-process-updates': summarizeProcessUpdates, // resume o e-mail do tribunal na captura, para o card do sino
  'generate-activity-title': generateActivityTitle,
  'nearby-establishments': nearbyEstablishments,
  'daily-team-report': dailyTeamReport,
  'report-query': reportQuery,
  'performance-coach': performanceCoach,
  'extract-acordo-from-ata': extractAcordoFromAta,
  'jm-documento-url': jmDocumentoUrl,
  'telao-narrar': telaoNarrar,
  'celcoin-open-finance': celcoinOpenFinance, // Open Finance/Celcoin — aqui e não em edge por causa do mTLS
  'update-profile-avatar': updateProfileAvatar, // foto de perfil — RLS do Externo barra o navegador, precisa de service role
};

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RAILWAY_API_KEY || '';

// Middleware base
app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));

// Autenticação de /functions/* — aceita chave interna, chave legada ou JWT do
// Cloud. Ver railway-server/src/lib/functionAuth.ts para o porquê de cada uma e
// para a explicação do modo observação.
//
// A guarda anterior era `if (API_KEY) { ... }`: com a variável vazia — que é o
// estado de produção — ela pulava a verificação inteira e todo o /functions/*
// aceitava POST anônimo, com o handler rodando sob service role no Externo.
app.use('/functions', async (req, res, next) => {
  const fnName = req.path.replace(/^\//, '');

  // Ponto de entrada de webhook: quem chama é serviço externo, não carrega
  // credencial nossa e não deve ser barrado por ela. A proteção certa aqui é
  // verificação de origem — medida por webhookOrigin.ts antes de virar exigência.
  if (WEBHOOK_PUBLIC_FUNCTIONS.has(fnName)) {
    recordPublicWebhook();
    observeUazapiOriginAsync(req.body);
    return next();
  }

  const verdict = await authorizeFunctionRequest(req);
  recordAuth(verdict, fnName);

  if (verdict.ok) {
    if (verdict.userId) (req as any).authUserId = verdict.userId;
    return next();
  }

  // Sem credencial. Em modo observação isto passa e vira log; o log é o insumo
  // para ligar o RAILWAY_AUTH_ENFORCE sabendo quem quebra.
  console.warn(
    JSON.stringify({
      event: 'functions.auth_missing',
      enforced: AUTH_ENFORCE,
      fn: req.path.replace(/^\//, ''),
      reason: verdict.reason,
      token: verdict.tokenSuffix ?? null, // só o sufixo: JWT não vai pra log
      rid: req.headers['x-request-id'] ?? null,
    }),
  );

  if (!AUTH_ENFORCE) return next();
  return res.status(401).json({ error: 'Unauthorized', reason: verdict.reason });
});

// Health check
app.get('/health', (_req, res) => {
  const gmailKeys = Object.keys(process.env)
    .filter((k) => k.startsWith('GOOGLE_MAIL_API_KEY'))
    .map((k) => ({ name: k, hasValue: !!(process.env[k] && process.env[k]!.trim()) }));
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    // Qual commit está no ar — sem isso não dá pra distinguir deploy de restart/crash.
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    // Só booleanos: diz se a porta do /functions/* está fechada e se cada
    // credencial está configurada, sem revelar nenhuma delas. É o que permite
    // conferir o estado de fora, sem acesso ao log do Railway.
    auth: {
      enforced: AUTH_ENFORCE,
      internal_key: !!process.env.RAILWAY_INTERNAL_KEY,
      api_key: !!API_KEY,
      cloud_jwt_ready: !!(process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY),
      // Placar desde o ultimo deploy. `missing_por_funcao` e a lista que precisa
      // estar vazia antes de ligar o enforce.
      observado: authStats(),
    },
    // Webhook da UazAPI: entra sem credencial de proposito (servico externo).
    // Aqui se mede se da pra exigir o instance_token como prova de origem —
    // `sem_token_por_evento` e a lista que precisa esvaziar antes disso.
    origem_webhook: uazapiOriginStats(),
    functions: Object.keys(functionHandlers),
    gmailKeys,
  });
});

// Rota pública da UazAPI. A UazAPI não envia x-api-key, então a instância
// vem pela URL e é repassada ao handler como instanceName quando o payload
// não trouxer esse campo.
app.post('/webhooks/uazapi/:instance_name', async (req, res) => {
  const instanceName = req.params.instance_name;
  observeUazapiOriginAsync(req.body);
  req.body = {
    ...(req.body || {}),
    instanceName: req.body?.instanceName || req.body?.InstanceName || req.body?.instance_name || req.body?.instance || instanceName,
  };

  try {
    await whatsappWebhook(req, res, () => {});
  } catch (err) {
    console.error('[webhooks/uazapi] Error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
});

// Rotas PÚBLICAS de revisão (sem x-api-key) — chamadas direto pelo navegador via link
// recebido no WhatsApp. A segurança vem do review_token (16 chars aleatórios) + expires_at.
app.post('/public/review/get', async (req, res) => {
  try {
    await getPendingReview(req, res, () => {});
  } catch (err) {
    console.error('[public/review/get] Error:', err);
    res.status(200).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/public/review/submit', async (req, res) => {
  try {
    await submitDocumentReview(req, res, () => {});
  } catch (err) {
    console.error('[public/review/submit] Error:', err);
    res.status(200).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
  }
});

// Rota pública chamada pelo Google Apps Script (onFormSubmit) — sem x-api-key.
// Segurança vem do token aleatório de 32 chars gravado em kanban_boards.sheet_webhook_token.
app.post('/webhooks/sheet-lead-ingest/:token', async (req, res) => {
  try {
    await sheetLeadIngest(req, res, () => {});
  } catch (err) {
    console.error('[webhooks/sheet-lead-ingest] Error:', err);
    res.status(200).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Rota pública UazAPI para eventos de grupo (saída/remoção de participantes).
// A UazAPI não envia x-api-key, então a instância vem pela URL, igual /webhooks/uazapi.
app.post('/webhooks/uazapi-group-exit/:instance_name', async (req, res) => {
  req.body = {
    ...(req.body || {}),
    instance_name: req.body?.instance_name || req.body?.instanceName || req.body?.instance || req.params.instance_name,
  };
  try {
    await whatsappGroupExit(req, res);
  } catch (err) {
    console.error('[webhooks/uazapi-group-exit] Error:', err);
    res.status(200).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Rota dinâmica para funções (protegida por x-api-key)
app.post('/functions/:name', async (req, res) => {
  const { name } = req.params;
  const handler = functionHandlers[name];

  if (!handler) {
    return res.status(404).json({
      error: `Function '${name}' not found on this server`,
      available: Object.keys(functionHandlers),
    });
  }

  try {
    await handler(req, res, () => {});
  } catch (err) {
    console.error(`[${name}] Error:`, err);
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// Rota pública para webhook ZapSign — encaminha pro edge function que tem a lógica completa
// (notificações, envio de PDF assinado, enrich-lead, anexo no lead, etc.)
const CLOUD_FUNCTIONS_URL = process.env.CLOUD_FUNCTIONS_URL || process.env.SUPABASE_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

app.post('/webhooks/zapsign', async (req, res) => {
  // Responde rápido pra ZapSign não reenviar; processa em background
  res.status(200).json({ success: true, forwarded: true });

  // 1) Forward pro Cloud zapsign-webhook (notif + PDF assinado + enrich-lead + attachments)
  try {
    const upstream = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/zapsign-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CLOUD_ANON_KEY}`,
        'apikey': CLOUD_ANON_KEY,
      },
      body: JSON.stringify(req.body),
    });
    const text = await upstream.text();
    console.log(`[webhooks/zapsign] forwarded → ${upstream.status} ${text.slice(0, 200)}`);
  } catch (err) {
    console.error('[webhooks/zapsign] forward error:', err);
  }

  // 2) Pós-assinatura: cria grupo + importa docs originais (Externo, sem Cloud novo)
  try {
    const docToken: string | null =
      req.body?.token || req.body?.doc_token || req.body?.open_id_token || req.body?.doc?.token || null;
    const status = req.body?.status || req.body?.event_type;
    if (docToken && (status === 'signed' || status === 'doc_signed')) {
      // Pequeno delay pra garantir que o forward acima já marcou zapsign_documents.status='signed'
      await new Promise((r) => setTimeout(r, 2500));
      await runPostSignExtras({ doc_token: docToken });
    }
  } catch (err) {
    console.error('[webhooks/zapsign] post-sign extras error:', err);
  }
});

// Webhook público da WhatsApp Cloud API (Meta).
// GET = verify challenge (Meta), POST = eventos.
// Rota pública, validação por X-Hub-Signature-256 dentro do handler.
app.get('/webhooks/whatsapp-cloud', (req, res) => whatsappCloudWebhook(req, res));
app.post('/webhooks/whatsapp-cloud', (req, res) => whatsappCloudWebhook(req, res));

// Start
app.listen(PORT, () => {
  console.log(`🚀 RMP Functions Server running on port ${PORT}`);
  console.log(`📋 Registered functions: ${Object.keys(functionHandlers).join(', ') || 'none yet'}`);
  console.log(
    `🔐 /functions/* auth: ${AUTH_ENFORCE ? 'ENFORCED' : 'modo observação (passa e loga)'}` +
      ` | internal_key:${process.env.RAILWAY_INTERNAL_KEY ? 'set' : 'unset'}` +
      ` api_key:${API_KEY ? 'set' : 'unset'} jwt_cloud:${process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY ? 'ok' : 'SEM ANON KEY'}`,
  );
});

// ============================================================
// CRON: rede de segurança — varre órfãos INSS a cada 15 min.
// Metáfora: o detetive volta na sala de cartas-sem-dono toda
// hora pra ver se chegou pista nova (lead novo cadastrado, etc.).
// ============================================================
const ORPHAN_SCAN_INTERVAL_MS = 15 * 60 * 1000;
async function runOrphanScan() {
  try {
    const url = `http://127.0.0.1:${PORT}/functions/match-inss-orphans`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Auto-chamada: o processo se autentica com o token efêmero do boot,
        // então o cron interno sobrevive ao enforce sem secret configurado.
        'x-internal-key': LOOPBACK_TOKEN,
        'x-api-key': API_KEY,
      },
      body: '{}',
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.scanned > 0 || json?.matched > 0) {
      console.log(`[cron:match-inss-orphans] scanned=${json.scanned} matched=${json.matched} notify=${json.notify_fired}`);
    }
  } catch (err) {
    console.warn('[cron:match-inss-orphans] failed:', err instanceof Error ? err.message : err);
  }
}
// Primeira execução 60s após start, depois a cada 15 min
setTimeout(runOrphanScan, 60_000);
setInterval(runOrphanScan, ORPHAN_SCAN_INTERVAL_MS);

// ============================================================
// CRON: relatório diário de gestão por time — roda todo dia às
// REPORT_HOUR_BRT (padrão 18h, horário de Brasília). A função é
// idempotente por dia, então checagem a cada 10 min é segura.
// ============================================================
const REPORT_HOUR_BRT = Number(process.env.REPORT_HOUR_BRT || 18);
let lastReportDate = '';
async function runDailyTeamReport() {
  try {
    const now = new Date();
    const spHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(now));
    const spDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
    if (spHour !== REPORT_HOUR_BRT || lastReportDate === spDate) return;
    lastReportDate = spDate;

    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/daily-team-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: '{}',
    });
    const json: any = await resp.json().catch(() => ({}));
    console.log(`[cron:daily-team-report] status=${resp.status}`, JSON.stringify(json?.results || {}));
  } catch (err) {
    console.warn('[cron:daily-team-report] failed:', err instanceof Error ? err.message : err);
  }
}
setInterval(runDailyTeamReport, 10 * 60 * 1000);

// ============================================================
// CRON: relatório diário de benefícios INSS por marco — dia útil
// às INSS_REPORT_HOUR_BRT (padrão 8h, Brasília). Envia por e-mail
// pra caixa adm@. Idempotente por dia; checagem a cada 10 min.
// ============================================================
const INSS_REPORT_HOUR_BRT = Number(process.env.INSS_REPORT_HOUR_BRT || 8);
let lastInssReportDate = '';
async function runInssReport() {
  try {
    const now = new Date();
    const spHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(now));
    const spDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
    const spWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(now);
    if (spWeekday === 'Sat' || spWeekday === 'Sun') return; // só dia útil
    if (spHour !== INSS_REPORT_HOUR_BRT || lastInssReportDate === spDate) return;
    lastInssReportDate = spDate;

    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/inss-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: JSON.stringify({ send: true }),
    });
    const json: any = await resp.json().catch(() => ({}));
    console.log(`[cron:inss-report] status=${resp.status} sent=${json?.sent}`);
  } catch (err) {
    console.warn('[cron:inss-report] failed:', err instanceof Error ? err.message : err);
  }
}
setInterval(runInssReport, 10 * 60 * 1000);

// ============================================================
// CRON: sincroniza a caixa do INSS a cada INSS_SYNC_INTERVAL_MIN
// (padrão 20). Até 03/08/2026 este sync só rodava quando alguém
// clicava na tela — a última execução tinha 3 dias, e é por isso
// que "protocolos de hoje" vivia zerado.
//
// Janela curta (6h) de propósito: rodando de 20 em 20 min, tudo
// que passar disso é releitura das mesmas mensagens, gastando
// cota do gateway à toa. As 6h dão folga pra cobrir uma janela
// de instabilidade sem precisar de backfill.
//
// Seguro pra rodar sozinho: o handler tem trava anti-sobreposição
// (syncInFlight), retry de 429 com espera de 62s e pacing de 400ms
// entre mensagens — o comentário dele já previa este cron.
// ============================================================
const INSS_SYNC_INTERVAL_MS = Number(process.env.INSS_SYNC_INTERVAL_MIN || 20) * 60 * 1000;
async function runInssSync() {
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/gmail-inss-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: JSON.stringify({ lookback_hours: 6 }),
    });
    const json: any = await resp.json().catch(() => ({}));
    // Rodada que não achou nada é o caso comum — só loga quando houve novidade
    // ou problema, pra não afogar o log do Railway.
    if (json?.new > 0 || json?.errors?.length) {
      console.log(`[cron:gmail-inss-sync] new=${json.new} checked=${json.checked} errors=${json.errors?.length || 0}`);
    }
  } catch (err) {
    console.warn('[cron:gmail-inss-sync] failed:', err instanceof Error ? err.message : err);
  }
}
// Escalonado do orphan scan (60s) pra não competirem no boot.
setTimeout(runInssSync, 120_000);
setInterval(runInssSync, INSS_SYNC_INTERVAL_MS);

// ============================================================
// CRON: despacha a fila de mensagens do INSS que esperou a
// janela de 8h–20h (BRT) — a cada 10 min.
//
// 28% dos e-mails do INSS chegam entre 20h e 8h. O
// notify-inss-update redige o texto na hora e deixa
// zap_status='agendado'; quem entrega é este cron. Fora da
// janela o handler devolve skipped, então rodar 24h não manda
// nada de madrugada.
// ============================================================
const INSS_ZAP_INTERVAL_MS = 10 * 60 * 1000;
async function runInssZapDispatch() {
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/dispatch-inss-zap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: JSON.stringify({}),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.sent > 0 || json?.failed > 0 || json?.expired > 0) {
      console.log(`[cron:dispatch-inss-zap] sent=${json.sent} failed=${json.failed} expired=${json.expired}`);
    }
  } catch (err) {
    console.warn('[cron:dispatch-inss-zap] failed:', err instanceof Error ? err.message : err);
  }
}
// Escalonado dos outros crons de boot (60s, 120s).
setTimeout(runInssZapDispatch, 150_000);
setInterval(runInssZapDispatch, INSS_ZAP_INTERVAL_MS);

// ============================================================
// CRON: relatos de acidente nos grupos marcados — a cada
// GROUP_REPORTS_INTERVAL_MIN (padrão 10).
//
// Precisa ser cron, e não gatilho no webhook: relato quase nunca
// cabe numa mensagem só ("caiu do andaime" / "quebrou a coluna" /
// "foi pro João XXIII"), então a IA tem que ler o pedaço de
// conversa, não a linha solta. E chamar IA por mensagem de grupo
// custaria uma fortuna à toa.
//
// Barato por construção: o handler pula sozinho todo grupo sem
// mensagem nova desde a última leitura (whatsapp_group_report_scans),
// então rodada em grupo parado não gasta chamada de IA.
// ============================================================
const GROUP_REPORTS_INTERVAL_MS = Number(process.env.GROUP_REPORTS_INTERVAL_MIN || 10) * 60 * 1000;
async function runGroupCaseReports() {
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/detect-group-case-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: '{}',
    });
    const json: any = await resp.json().catch(() => ({}));
    // Rodada sem relato novo é o caso comum — só loga novidade ou erro.
    if (json?.created > 0 || json?.success === false) {
      console.log(`[cron:detect-group-case-reports] grupos=${json?.groups_scanned} relatos=${json?.created} erro=${json?.error || 'nenhum'}`);
    }
  } catch (err) {
    console.warn('[cron:detect-group-case-reports] failed:', err instanceof Error ? err.message : err);
  }
}
// Escalonado dos outros crons de boot (60s, 120s).
setTimeout(runGroupCaseReports, 180_000);
setInterval(runGroupCaseReports, GROUP_REPORTS_INTERVAL_MS);

// ============================================================
// CRON: sync de status do funil Aux. Acidente (planilha → CRM),
// a cada 10 min. Substitui o pg_cron `sync-funnel-status-aux-acidente`
// do Externo (migration 20260730193000), que batia nesta mesma função
// pela URL pública SEM credencial nenhuma — era o segundo chamador
// anônimo do /functions/*, e o único que sobrava depois do webhook.
//
// Trazendo o disparo pra dentro do processo, ele passa a se autenticar
// com o LOOPBACK_TOKEN do boot e deixa de depender de secret: a função
// pode ser fechada sem quebrar o sync.
//
// Idempotente por construção (carimbo leads.capi_purchase_sent_at), então
// rodar em paralelo com o pg_cron durante a transição não duplica Purchase
// nem reimporta lead. Desligar o pg_cron é passo separado:
//   select cron.unschedule('sync-funnel-status-aux-acidente');
// ============================================================
const FUNNEL_SYNC_INTERVAL_MS = 10 * 60 * 1000;
async function runFunnelStatusSync() {
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/sync-funnel-status-from-sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: JSON.stringify({ dry_run: false }),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.status_updated > 0 || json?.imported_closed > 0 || json?.purchases_fired > 0 || json?.error) {
      console.log(
        `[cron:sync-funnel-status] updated=${json.status_updated ?? 0} imported=${json.imported_closed ?? 0} purchases=${json.purchases_fired ?? 0}${json.error ? ` error=${json.error}` : ''}`,
      );
    }
  } catch (err) {
    console.warn('[cron:sync-funnel-status] failed:', err instanceof Error ? err.message : err);
  }
}
// Escalonado dos demais (60s/120s) pra não competirem no boot.
setTimeout(runFunnelStatusSync, 180_000);
setInterval(runFunnelStatusSync, FUNNEL_SYNC_INTERVAL_MS);

// ============================================================
// CRON: caixa processual do Gmail, de hora em hora. Substitui o
// pg_cron `gmail-processual-sync-hourly` do Externo, que mandava
// `x-api-key` buscado em `vault.decrypted_secrets` com name
// 'RAILWAY_API_KEY' — segredo que NUNCA existiu (o vault do Externo
// está vazio). Na prática o header ia nulo e a chamada chegava aqui
// sem credencial nenhuma.
//
// Rodando por dentro, autentica com o LOOPBACK_TOKEN do boot e para
// de depender de segredo em dois lugares.
//   Desligar o pg_cron: select cron.unschedule('gmail-processual-sync-hourly');
// ============================================================
const PROCESSUAL_SYNC_INTERVAL_MS = 60 * 60 * 1000;
// Rodada que estourou o orçamento devolve `done:false` + cursor. Sem devolver o
// cursor na chamada seguinte, o cron recomeçava do zero toda hora e nunca passava
// do ponto em que parou — a caixa seguinte da fila jamais era lida.
let processualCursor: { inbox: string | null; page_token: string | null } | null = null;
async function runProcessualSync() {
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/gmail-processual-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: JSON.stringify(processualCursor ? { cursor: processualCursor } : {}),
    });
    const json: any = await resp.json().catch(() => ({}));
    // Terminou a varredura → próxima rodada começa do topo da janela.
    processualCursor = json?.success && json?.done === false ? (json.cursor ?? null) : null;
    // Rodada sem e-mail novo é o caso comum — só loga novidade ou problema.
    if (json?.total_inserted > 0 || json?.success === false || !resp.ok) {
      console.log(
        `[cron:gmail-processual-sync] status=${resp.status} inserted=${json?.total_inserted ?? 0} checked=${json?.total_checked ?? 0}${processualCursor ? ` resume=${processualCursor.inbox}` : ''}${json?.error ? ` error=${json.error}` : ''}`,
      );
    }
  } catch (err) {
    console.warn('[cron:gmail-processual-sync] failed:', err instanceof Error ? err.message : err);
  }
}
// Escalonado dos demais (60s/120s/180s) pra não competirem no boot.
setTimeout(runProcessualSync, 240_000);
setInterval(runProcessualSync, PROCESSUAL_SYNC_INTERVAL_MS);

// ============================================================
// CRON: resumo por IA do que caiu no processo.
//
// O sino abre com até 100 cards; resumir no render seria 100 chamadas de IA
// por abertura. Aqui cada movimentação é resumida UMA vez, logo depois de
// chegar, e vira texto no banco (process_updates.resumo_ia).
//
// De 10 em 10 minutos, 20 por rodada = 120/hora, folgado sobre o fluxo real
// (~200 movimentações por semana, medido em 12/08/2026). Enquanto houver
// atraso a fila anda sozinha; quando zera, a rodada não faz nada e não
// chama IA nenhuma.
// ============================================================
const SUMMARIZE_UPDATES_INTERVAL_MS = 10 * 60 * 1000;
async function runSummarizeProcessUpdates() {
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/summarize-process-updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      body: JSON.stringify({}),
    });
    const json: any = await resp.json().catch(() => ({}));
    // Fila vazia é o caso comum — só loga quando resumiu algo ou quebrou.
    if (json?.resumidas > 0 || json?.success === false || !resp.ok) {
      console.log(
        `[cron:summarize-process-updates] status=${resp.status} resumidas=${json?.resumidas ?? 0} tentadas=${json?.tentadas ?? 0}${json?.sem_material ? ` sem_material=${json.sem_material}` : ''}${json?.error ? ` error=${json.error}` : ''}`,
      );
    }
  } catch (err) {
    console.warn('[cron:summarize-process-updates] failed:', err instanceof Error ? err.message : err);
  }
}
// Depois do sync processual (240s): resumir antes de capturar seria resumir o vazio.
setTimeout(runSummarizeProcessUpdates, 300_000);
setInterval(runSummarizeProcessUpdates, SUMMARIZE_UPDATES_INTERVAL_MS);

// ============================================================
// CRON: importa audiências da planilha, 1x por dia às
// HEARINGS_SYNC_HOUR_BRT:HEARINGS_SYNC_MINUTE_BRT (padrão 08:30,
// Brasília) — mesmo horário do pg_cron `sync-hearings-from-sheet-daily`
// que ele substitui, e que também chegava aqui sem credencial.
//
// Segue o padrão do daily-team-report (intervalo curto + checagem de
// hora + trava por dia) em vez de um setInterval de 24h: intervalo longo
// não sobrevive a restart do Railway — cada deploy remarcaria o disparo
// para 24h depois, e a importação simplesmente nunca aconteceria.
//   Desligar o pg_cron: select cron.unschedule('sync-hearings-from-sheet-daily');
// ============================================================
const HEARINGS_SYNC_HOUR_BRT = Number(process.env.HEARINGS_SYNC_HOUR_BRT || 8);
const HEARINGS_SYNC_MINUTE_BRT = Number(process.env.HEARINGS_SYNC_MINUTE_BRT || 30);
let lastHearingsSyncDate = '';
async function runHearingsSync() {
  try {
    const now = new Date();
    const spHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(now));
    const spMinute = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', minute: 'numeric' }).format(now));
    const spDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
    if (spHour !== HEARINGS_SYNC_HOUR_BRT || spMinute < HEARINGS_SYNC_MINUTE_BRT) return;
    if (lastHearingsSyncDate === spDate) return;
    lastHearingsSyncDate = spDate;

    const resp = await fetch(`http://127.0.0.1:${PORT}/functions/sync-hearings-from-sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': LOOPBACK_TOKEN, 'x-api-key': API_KEY },
      // Mesmo corpo do pg_cron: `confirm` é a trava do handler contra execução acidental.
      body: JSON.stringify({ apply: true, confirm: 'SYNC' }),
    });
    const json: any = await resp.json().catch(() => ({}));
    console.log(
      `[cron:sync-hearings-from-sheet] status=${resp.status} inserted=${json?.inserted ?? 0} updated=${json?.updated ?? 0} errors=${json?.errors?.length || 0}${json?.error ? ` error=${json.error}` : ''}`,
    );
  } catch (err) {
    console.warn('[cron:sync-hearings-from-sheet] failed:', err instanceof Error ? err.message : err);
  }
}
setInterval(runHearingsSync, 10 * 60 * 1000);

// ============================================================
// CRON: sincroniza Open Finance / Celcoin (conciliação bancária).
// Roda nas horas de CELCOIN_SYNC_HOURS_BRT (padrão 06, 12 e 19h,
// Brasília), com trava por data+hora. Idempotente: o upsert usa a
// UNIQUE (provider, pluggy_transaction_id), então rodar de novo
// sobrescreve a mesma linha em vez de duplicar.
//
// POR QUE AQUI E NÃO NUM pg_cron DO EXTERNO (medido em 19/08/2026):
// a edge exige service_role no Authorization (ou um JWT de sessão do
// Cloud em x-cloud-jwt) — ela cria consentimento e lê extrato com a
// credencial da firma. Os 13 pg_cron do Externo que mandam Bearer
// carregam TODOS a anon key; nenhum tem service_role. Copiar o Bearer
// de um job existente, que é o padrão da casa, produziria 401 calado
// todo dia. A alternativa seria gravar a service_role em texto puro
// dentro de cron.job.command — e daí também dentro da migration no
// repo. Aqui a chave já existe em EXTERNAL_SUPABASE_SERVICE_ROLE_KEY
// e nenhum segredo novo circula. O bloqueio geográfico da Celcoin não
// atrapalha: quem fala com a Celcoin é a edge, de São Paulo; o Railway
// só fala com o Supabase.
//
// Intervalo curto + checagem de hora, e não setInterval de 24h, pelo
// mesmo motivo do sync-hearings: intervalo longo não sobrevive a
// restart, e cada deploy adiaria o disparo.
// ============================================================
const CELCOIN_SYNC_HOURS_BRT = String(process.env.CELCOIN_SYNC_HOURS_BRT || '6,12,19')
  .split(',')
  .map((h) => Number(h.trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
let lastCelcoinSyncKey = '';
async function runCelcoinSync() {
  try {
    if (!CELCOIN_SYNC_HOURS_BRT.length) return;
    const now = new Date();
    const spHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(now));
    const spDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
    if (!CELCOIN_SYNC_HOURS_BRT.includes(spHour)) return;
    const key = `${spDate}T${spHour}`;
    if (lastCelcoinSyncKey === key) return;
    lastCelcoinSyncKey = key;

    // Sem janela no corpo: a edge decide o piso sozinha (syncFloor), que é o
    // que evita buraco no dia corrente e duplicata por cima da Pluggy.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);
    try {
      const resp = await fetch(`${EXTERNAL_SUPABASE_URL}/functions/v1/celcoin-open-finance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${EXTERNAL_SERVICE_ROLE_KEY}`,
          apikey: EXTERNAL_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ action: 'sync_all' }),
        signal: ctrl.signal,
      });
      const json: any = await resp.json().catch(() => ({}));
      const linha =
        `[cron:celcoin-sync] status=${resp.status} consentimentos=${json?.consentimentos ?? '?'} ` +
        `falhas=${json?.falhas ?? '?'} bancarias=${json?.bank_transactions ?? 0} cartao=${json?.credit_card_transactions ?? 0}`;
      // Conexão que falha é o modo de morte desta integração: consentimento
      // revogado ou vencido para de trazer dado e a tela não acusa nada. Sai
      // como erro para ficar visível no log sem ninguém abrir o corpo.
      if (!resp.ok || json?.falhas) {
        const quais = (json?.resultados || [])
          .filter((r: any) => !r?.ok)
          .map((r: any) => `${r?.brand_name || r?.consent_id}: ${r?.erro || 'sem detalhe'}`)
          .join(' | ');
        console.error(`${linha}${quais ? ` -> ${quais}` : ''}${json?.error ? ` error=${json.error}` : ''}`);
      } else {
        console.log(linha);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[cron:celcoin-sync] failed:', err instanceof Error ? err.message : err);
  }
}
setInterval(runCelcoinSync, 10 * 60 * 1000);
