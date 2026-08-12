/**
 * Diagnóstico da conexão com o Gmail — caixa por caixa.
 *
 * Existe porque não havia como responder, de fora, três perguntas básicas:
 * quais caixas estão plugadas, QUAL endereço é cada uma, e se cada uma pode
 * ENVIAR ou só ler. Sem isso, todo problema de e-mail virava adivinhação sobre
 * env var — foi assim que o send-email ficou apontado pra uma connection key
 * inexistente sem ninguém perceber.
 *
 * POST /functions/gmail-status   { probe_send?: boolean }
 *   probe_send=false → pula o teste de escopo de envio (default: faz o teste)
 *
 * O teste de envio NÃO manda e-mail: faz POST em /messages/send com um `raw`
 * deliberadamente sem destinatário. O Gmail valida o envelope antes de aceitar,
 * então a resposta é 400 (tem escopo, payload recusado) ou 403 (sem escopo).
 * Nenhuma mensagem é entregue nem fica em rascunho nos dois casos.
 *
 * Envs: LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY[, _1.._5],
 *       PROCESSUAL_INBOXES, INSS_INBOXES (definem qual caixa é qual).
 */
import type { RequestHandler } from 'express';
import { listGmailInboxes, resolveSenderInbox } from '../lib/gmail-inboxes';

const GATEWAY_BASE = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

/** Mascara o endereço: prova que a caixa é a esperada sem despejar o e-mail. */
function maskEmail(addr?: string | null): string | null {
  if (!addr) return null;
  const [user, domain] = addr.split('@');
  if (!domain) return '***';
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

interface ProbeResult {
  pode_enviar: boolean | null;
  status: number | null;
  detalhe: string | null;
}

/** Envelope sem `To:` — o Gmail recusa antes de entregar seja o que for. */
function probeRaw(): string {
  const msg = 'Subject: gmail-status probe (nao enviado)\r\n\r\n';
  return Buffer.from(msg, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function probeSendScope(lovableKey: string, connectionKey: string): Promise<ProbeResult> {
  try {
    const r = await fetch(`${GATEWAY_BASE}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': connectionKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: probeRaw() }),
    });
    const texto = (await r.text()).slice(0, 300);

    if (r.status === 403) {
      return {
        pode_enviar: false,
        status: 403,
        detalhe: 'Escopo de envio ausente — a conexão foi autorizada só para leitura. '
          + 'Reautorizar o conector incluindo gmail.send.',
      };
    }
    if (r.status === 401) {
      return { pode_enviar: false, status: 401, detalhe: 'Connection key inválida ou expirada.' };
    }
    if (r.status === 400) {
      // Passou da autorização e morreu na validação do envelope: é o esperado.
      return { pode_enviar: true, status: 400, detalhe: 'Escopo de envio OK (envelope recusado, como esperado).' };
    }
    if (r.ok) {
      // Não deveria acontecer — sem destinatário o Gmail recusa. Reporta cru.
      return { pode_enviar: true, status: r.status, detalhe: `Resposta inesperada ${r.status}: ${texto}` };
    }
    return { pode_enviar: null, status: r.status, detalhe: `Inconclusivo (${r.status}): ${texto}` };
  } catch (e: any) {
    return { pode_enviar: null, status: null, detalhe: `Falha na chamada: ${e?.message || String(e)}` };
  }
}

export const handler: RequestHandler = async (req, res) => {
  const query = (req.query || {}) as any;
  const body = (req.body || {}) as any;
  const raw = String(body.probe_send ?? query.probe_send ?? 'true').toLowerCase();
  const doProbe = raw !== 'false' && raw !== '0';

  const lovableKey = (process.env.LOVABLE_API_KEY || '').trim();
  if (!lovableKey) {
    return res.status(200).json({
      success: false,
      error: 'LOVABLE_API_KEY ausente no Railway — sem ela nenhuma caixa responde.',
    });
  }

  const inboxes = listGmailInboxes();
  if (inboxes.length === 0) {
    return res.status(200).json({
      success: false,
      error: 'Nenhuma GOOGLE_MAIL_API_KEY* configurada no Railway.',
    });
  }

  const caixas = [];
  for (const inbox of inboxes) {
    const linha: Record<string, unknown> = {
      label: inbox.label,
      env: inbox.envName,
      endereco: null,
      total_mensagens: null,
      pode_ler: false,
      leitura_detalhe: null,
      pode_enviar: null,
      envio_detalhe: null,
    };

    try {
      const r = await fetch(`${GATEWAY_BASE}/users/me/profile`, {
        headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': inbox.key },
      });
      if (r.ok) {
        const perfil = (await r.json()) as { emailAddress?: string; messagesTotal?: number };
        linha.pode_ler = true;
        linha.endereco = maskEmail(perfil.emailAddress);
        linha.total_mensagens = perfil.messagesTotal ?? null;
      } else {
        linha.leitura_detalhe = `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
      }
    } catch (e: any) {
      linha.leitura_detalhe = `Falha na chamada: ${e?.message || String(e)}`;
    }

    if (doProbe) {
      const probe = await probeSendScope(lovableKey, inbox.key);
      linha.pode_enviar = probe.pode_enviar;
      linha.envio_detalhe = probe.detalhe;
    }

    caixas.push(linha);
  }

  // Qual caixa o send-email usaria hoje, para cada tipo de processo. É o que
  // liga o diagnóstico ao comportamento real do envio.
  const remetentes: Record<string, unknown> = {};
  for (const tipo of ['judicial', 'administrativo']) {
    const { inbox, origem, erro } = resolveSenderInbox(tipo);
    remetentes[tipo] = inbox
      ? { label: inbox.label, env: inbox.envName, origem }
      : { label: null, origem, erro };
  }

  return res.status(200).json({
    success: true,
    probe_send: doProbe,
    caixas,
    remetentes,
    allowlists: {
      PROCESSUAL_INBOXES: process.env.PROCESSUAL_INBOXES || null,
      INSS_INBOXES: process.env.INSS_INBOXES || null,
    },
  });
};
