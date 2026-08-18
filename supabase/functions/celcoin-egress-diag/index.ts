// =============================================================================
// celcoin-egress-diag — sonda de borda, descartável.
//
// Por que existe (18/08/2026): o `list_brands` do Railway tomou 403 cujo corpo
// era HTML de WAF, não JSON da aplicação. Medido: o IP de saída do Railway é
// 152.55.177.153 (Santa Clara, US) e a Celcoin barra tráfego de fora do Brasil
// — a mesma chamada daqui do Brasil responde 400 invalid_client normalmente.
//
// Esta função existe só para responder UMA pergunta antes de reescrever
// qualquer coisa: o egress das edges deste projeto sai do Brasil?
//
// Não recebe parâmetro, não lê banco, não usa segredo. A credencial da sonda é
// a string literal "probe:probe", inválida de propósito: se a Celcoin responder
// 400 invalid_client, a requisição CHEGOU na aplicação (caminho aberto); se
// responder HTML, foi barrada na borda (mesmo problema do Railway).
//
// APAGAR depois de decidir o caminho. Não é infraestrutura.
// =============================================================================
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ONBOARD = 'https://onboard-ui.smartkeys.celcoin.production.fsapps.app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const out: Record<string, unknown> = {};

  try {
    const r = await fetch('https://api.ipify.org?format=json');
    out.egress_ip = (await r.json())?.ip ?? null;
  } catch (e) {
    out.egress_ip_erro = String((e as Error)?.message).slice(0, 200);
  }

  try {
    const geo = await fetch(`https://ipinfo.io/${out.egress_ip}/json`);
    const g = await geo.json();
    out.egress_pais = g?.country ?? null;
    out.egress_local = [g?.city, g?.region].filter(Boolean).join(', ') || null;
    out.egress_org = g?.org ?? null;
  } catch {
    /* geo é acessório: se falhar, o IP já basta */
  }

  try {
    const probe = await fetch(`${ONBOARD}/api/portal/onboard/v2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa('probe:probe')}`, Accept: 'application/json' },
    });
    const txt = await probe.text();
    out.probe_status = probe.status;
    out.probe_e_html = /^\s*<(!doctype|html)/i.test(txt);
    out.probe_trecho = txt.slice(0, 200);
    // Este é o veredito que interessa.
    out.chega_na_aplicacao = probe.status === 400 && txt.includes('invalid_client');
  } catch (e) {
    out.probe_erro = String((e as Error)?.message).slice(0, 200);
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
