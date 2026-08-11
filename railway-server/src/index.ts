import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authorizeFunctionRequest, AUTH_ENFORCE, LOOPBACK_TOKEN, recordAuth, authStats } from './lib/functionAuth';

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
import { handler as suggestRevisionReason } from './functions/suggest-revision-reason';
import { handler as wipeInstanceAgentLabels } from './functions/wipe-instance-agent-labels';
import { handler as transcodeAudioOpus } from './functions/transcode-audio-opus';
import { handler as extractActivityFromDocument } from './functions/extract-activity-from-document';
import { handler as dictateActivity } from './functions/dictate-activity';
import { handler as chatToActivity } from './functions/chat-to-activity';
import { handler as detectClientCommitments } from './functions/detect-client-commitments';
import { handler as callToActivities } from './functions/call-to-activities';
import { handler as activityFromMovement } from './functions/activity-from-movement';
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
  'call-to-activities': callToActivities,
  'activity-from-movement': activityFromMovement,
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
  const verdict = await authorizeFunctionRequest(req);
  recordAuth(verdict, req.path.replace(/^\//, ''));

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
