import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// REGISTRO DE HANDLERS — Adicione funções migradas aqui
// ============================================================
import { handler as whatsappWebhook } from './functions/whatsapp-webhook';
import { handler as callQueueProcessor } from './functions/call-queue-processor';
import { handler as repairWhatsappGroup } from './functions/repair-whatsapp-group';
import { handler as zapsignWebhook } from './functions/zapsign-webhook';

const functionHandlers: Record<string, express.RequestHandler> = {
  'whatsapp-webhook': whatsappWebhook,
  'call-queue-processor': callQueueProcessor,
  'repair-whatsapp-group': repairWhatsappGroup,
  'zapsign-webhook': zapsignWebhook,
};

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RAILWAY_API_KEY || '';

// Middleware base
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    functions: Object.keys(functionHandlers),
  });
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
const CLOUD_FUNCTIONS_URL = process.env.SUPABASE_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

app.post('/webhooks/zapsign', async (req, res) => {
  // Responde rápido pra ZapSign não reenviar; processa em background
  res.status(200).json({ success: true, forwarded: true });

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
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 RMP Functions Server running on port ${PORT}`);
  console.log(`📋 Registered functions: ${Object.keys(functionHandlers).join(', ') || 'none yet'}`);
  console.log(`🔐 API Key protection on /functions/*: ${API_KEY ? 'enabled' : 'DISABLED'}`);
});
