import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

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
import { handler as syncHearingsFromSheet } from './functions/sync-hearings-from-sheet';
import { handler as gmailInssSync } from './functions/gmail-inss-sync';
import { handler as notifyInssUpdate } from './functions/notify-inss-update';
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
import { handler as wipeInstanceAgentLabels } from './functions/wipe-instance-agent-labels';
import { handler as transcodeAudioOpus } from './functions/transcode-audio-opus';
import { handler as extractActivityFromDocument } from './functions/extract-activity-from-document';
import { handler as dictateActivity } from './functions/dictate-activity';
import { handler as chatToActivity } from './functions/chat-to-activity';
import { handler as activityFromMovement } from './functions/activity-from-movement';
import { handler as nearbyEstablishments } from './functions/nearby-establishments';
import { handler as dailyTeamReport } from './functions/daily-team-report';
import { handler as reportQuery } from './functions/report-query';
import { handler as performanceCoach } from './functions/performance-coach';



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
  'wipe-instance-agent-labels': wipeInstanceAgentLabels,
  'bpc-sheet-sync': bpcSheetSync,
  'sync-hearings-from-sheet': syncHearingsFromSheet,
  'transcode-audio-opus': transcodeAudioOpus,
  'extract-activity-from-document': extractActivityFromDocument,
  'dictate-activity': dictateActivity,
  'chat-to-activity': chatToActivity,
  'activity-from-movement': activityFromMovement,
  'nearby-establishments': nearbyEstablishments,
  'daily-team-report': dailyTeamReport,
  'report-query': reportQuery,
  'performance-coach': performanceCoach,
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

// Autenticação via API key — protege apenas /functions/*
app.use('/functions', (req, res, next) => {
  if (API_KEY) {
    const providedKey = req.headers['x-api-key'];
    if (providedKey !== API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
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
    functions: Object.keys(functionHandlers),
    gmailKeys,
  });
});

// Rota pública da UazAPI. A UazAPI não envia x-api-key, então a instância
// vem pela URL e é repassada ao handler como instanceName quando o payload
// não trouxer esse campo.
app.post('/webhooks/uazapi/:instance_name', async (req, res) => {
  const instanceName = req.params.instance_name;
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
  console.log(`🔐 API Key protection on /functions/*: ${API_KEY ? 'enabled' : 'DISABLED'}`);
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
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: '{}',
    });
    const json: any = await resp.json().catch(() => ({}));
    console.log(`[cron:daily-team-report] status=${resp.status}`, JSON.stringify(json?.results || {}));
  } catch (err) {
    console.warn('[cron:daily-team-report] failed:', err instanceof Error ? err.message : err);
  }
}
setInterval(runDailyTeamReport, 10 * 60 * 1000);
