// Meta Conversions API — normalização, hash e despacho.
//
// Ponto único onde dado de cliente vira hash e onde a conversão vira valor.
// Os chamadores (front, planilha, enriquecimento) mandam só `lead_id`: quem
// lê e-mail/telefone é aqui, com service role, e o que sai para a fila já é
// SHA-256. Assim o dado pessoal não trafega pelo navegador nem fica em claro
// em `meta_capi_events` (LGPD).
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
import { supabase } from './supabase';

// v21.0 era a da edge antiga; a atual é v25.0.
export const GRAPH_VERSION = 'v25.0';

// Nomes novos, com fallback para os secrets que a edge já usava.
export const CAPI_TOKEN =
  process.env.META_CAPI_ACCESS_TOKEN || process.env.FACEBOOK_CAPI_ACCESS_TOKEN || '';
export const CAPI_DATASET_ID =
  process.env.META_CAPI_DATASET_ID || process.env.FACEBOOK_PIXEL_ID || '';
const VALOR_PADRAO = Number(process.env.META_CAPI_VALOR_PADRAO || 0);

export type Origem = 'kanban' | 'pipeline' | 'planilha' | 'auto_enrich' | 'manual' | 'backfill' | 'zapsign';
export type ValorOrigem = 'informado' | 'faixa_produto' | 'padrao' | 'ausente';

// Normalização, hash e regra de correspondência moram em `metaCapiNormalize`
// (funções puras, com teste). Reexportadas para quem já importava daqui.
export {
  toE164BR,
  montaCorrespondencia,
  temCorrespondenciaUtil,
  type DadosCorrespondencia,
} from './metaCapiNormalize';

/**
 * Valor da conversão e a procedência dele.
 * Medido de novo em 04/09/2026, sobre os 3.173 leads fechados:
 *   - `conversion_value > 0`:            0   (ninguém preenche o valor real)
 *   - com produto E faixa de preço:  2.245   (71%) -> valor estimado
 *   - sem produto nenhum:              928   (29%) -> fica SEM valor
 *
 * Os 29% importam: `Purchase` sem `value` é recusado pela Meta com subcode
 * 2804009 ("Missing Value for Purchase Event"), então esses fechamentos não
 * viram evento — ficam na fila como ignorados, com o motivo à vista. O
 * conserto é preencher o produto no lead, não inventar valor aqui.
 *
 * `valor_origem` guarda a procedência: o painel nunca apresenta estimativa
 * como se fosse receita apurada.
 */
export async function resolveValor(lead: {
  conversion_value?: number | null;
  product_service_id?: string | null;
}): Promise<{ valor: number | null; valor_origem: ValorOrigem }> {
  const informado = Number(lead.conversion_value || 0);
  if (informado > 0) return { valor: informado, valor_origem: 'informado' };

  if (lead.product_service_id) {
    const { data } = await supabase
      .from('products_services')
      .select('price_range_min, price_range_max')
      .eq('id', lead.product_service_id)
      .maybeSingle();
    const min = Number((data as any)?.price_range_min || 0);
    const max = Number((data as any)?.price_range_max || 0);
    if (min > 0 && max > 0) {
      return { valor: Math.round(((min + max) / 2) * 100) / 100, valor_origem: 'faixa_produto' };
    }
    if (min > 0) return { valor: min, valor_origem: 'faixa_produto' };
  }

  if (VALOR_PADRAO > 0) return { valor: VALOR_PADRAO, valor_origem: 'padrao' };
  return { valor: null, valor_origem: 'ausente' };
}

export interface RespostaMeta {
  ok: boolean;
  http_status: number;
  events_received?: number;
  fbtrace_id?: string;
  corpo: unknown;
  /** Erro de credencial/config: retentar não resolve, alguém precisa agir. */
  credencial_morta: boolean;
  /**
   * Payload que a Meta recusa por conteúdo (400 fora de credencial): retentar
   * manda exatamente o mesmo corpo e recebe exatamente a mesma recusa. Ex.:
   * subcode 2804009, "Purchase sem value". Alguém precisa corrigir a origem.
   */
  erro_definitivo: boolean;
}

/**
 * POST no endpoint de eventos, com retry só onde retry adianta.
 * 429 e 5xx são transitórios. 190 (token) e 803/#100 (dataset) não são: o
 * despachante para de insistir e marca a credencial como morta, que é o
 * sinal que faltava em 31/07/2026.
 */
export async function enviaParaMeta(
  eventos: unknown[],
  testEventCode?: string,
  maxTentativas = 3,
): Promise<RespostaMeta> {
  if (!CAPI_TOKEN || !CAPI_DATASET_ID) {
    return {
      ok: false,
      http_status: 0,
      corpo: { erro: 'META_CAPI_ACCESS_TOKEN ou META_CAPI_DATASET_ID ausente no ambiente' },
      credencial_morta: true,
      erro_definitivo: false,
    };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${CAPI_DATASET_ID}/events`;
  const payload: Record<string, unknown> = { data: eventos, access_token: CAPI_TOKEN };
  if (testEventCode) payload.test_event_code = testEventCode;
  const corpoReq = JSON.stringify(payload);

  let ultimo: RespostaMeta | null = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpoReq,
      });
      const texto = await resp.text();
      let corpo: any;
      try {
        corpo = JSON.parse(texto);
      } catch {
        corpo = { erro: 'resposta não-JSON', texto: texto.slice(0, 500) };
      }

      const codigo = corpo?.error?.code;
      const credencial_morta = codigo === 190 || codigo === 200 || codigo === 803;
      // 400 que não é credencial é recusa de conteúdo: mesmo corpo, mesma resposta.
      const erro_definitivo = !credencial_morta && resp.status === 400 && !!corpo?.error;

      ultimo = {
        ok: resp.ok && !corpo?.error,
        http_status: resp.status,
        events_received: corpo?.events_received,
        fbtrace_id: corpo?.fbtrace_id ?? corpo?.error?.fbtrace_id,
        corpo,
        credencial_morta,
        erro_definitivo,
      };

      if (ultimo.ok || credencial_morta || erro_definitivo) return ultimo;
      if (resp.status !== 429 && resp.status < 500) return ultimo;

      if (tentativa < maxTentativas) {
        const retryAfter = Number(resp.headers.get('retry-after')) || 0;
        const espera = Math.max(retryAfter * 1000, 500 * 2 ** (tentativa - 1));
        console.warn(`[capi] HTTP ${resp.status}, tentativa ${tentativa}/${maxTentativas} em ${espera}ms`);
        await new Promise((r) => setTimeout(r, espera));
      }
    } catch (err) {
      ultimo = {
        ok: false,
        http_status: 0,
        corpo: { erro: err instanceof Error ? err.message : String(err) },
        credencial_morta: false,
        erro_definitivo: false,
      };
      if (tentativa < maxTentativas) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (tentativa - 1)));
      }
    }
  }

  return (
    ultimo ?? {
      ok: false,
      http_status: 0,
      corpo: { erro: 'sem resposta' },
      credencial_morta: false,
      erro_definitivo: false,
    }
  );
}

/** Carimba o estado da credencial para o painel e para o alerta. */
export async function registraStatusCredencial(campos: {
  token_valido?: boolean;
  erro?: string | null;
  app_id?: string | null;
  sucesso?: boolean;
}): Promise<void> {
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    id: 1,
    ultimo_probe_em: agora,
    dataset_id: CAPI_DATASET_ID || null,
  };
  if (campos.token_valido !== undefined) patch.token_valido = campos.token_valido;
  if (campos.erro !== undefined) patch.erro = campos.erro;
  if (campos.app_id !== undefined) patch.app_id = campos.app_id;
  if (campos.sucesso) patch.ultimo_sucesso_em = agora;

  const { error } = await supabase.from('meta_capi_status').upsert(patch as any, { onConflict: 'id' });
  if (error) console.warn('[capi] falha ao gravar meta_capi_status:', error.message);
}
