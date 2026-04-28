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

const functionHandlers: Record<string, express.RequestHandler> = {
  'whatsapp-webhook': whatsappWebhook,
  'call-queue-processor': callQueueProcessor,
  'repair-whatsapp-group': repairWhatsappGroup,
};

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RAILWAY_API_KEY || '';

// Middleware base
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ROTA PÚBLICA — UazAPI webhook (sem x-api-key)
// UazAPI não envia headers customizados; esta rota é exposta
// para receber webhooks diretamente das instâncias.
// O handler valida instance_name contra o banco antes de persistir.
// IMPORTANTE: registrada ANTES do middleware de auth de /functions.
// ============================================================
app.post('/webhooks/uazapi/:instance_name', async (req, res) => {
  try {
    await whatsappWebhook(req, res, () => {});
  } catch (err) {
    console.error('[uazapi-webhook] Error:', err);
    if (!res.headersSent) {
      res.status(200).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
});

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
    public_routes: ['/webhooks/uazapi/:instance_name'],
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

// Start
app.listen(PORT, () => {
  console.log(`🚀 RMP Functions Server running on port ${PORT}`);
  console.log(`📋 Registered functions: ${Object.keys(functionHandlers).join(', ') || 'none yet'}`);
  console.log(`🔐 API Key protection on /functions/*: ${API_KEY ? 'enabled' : 'DISABLED'}`);
  console.log(`🌐 Public webhook route: POST /webhooks/uazapi/:instance_name`);
});
