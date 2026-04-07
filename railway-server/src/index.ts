import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RAILWAY_API_KEY || '';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Autenticação via API key
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

// ============================================================
// REGISTRO DE HANDLERS — Adicione funções migradas aqui
// ============================================================

const functionHandlers: Record<string, express.RequestHandler> = {};

// Importar handlers conforme migrados
// Exemplo: 
// import { handler as whatsappWebhook } from './functions/whatsapp-webhook';
// functionHandlers['whatsapp-webhook'] = whatsappWebhook;

// Rota dinâmica para funções
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
  console.log(`🔐 API Key protection: ${API_KEY ? 'enabled' : 'DISABLED'}`);
});
