import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BpcDateType = "created" | "first_contact" | "last_contact";

export const BPC_DATE_TYPE_LABEL: Record<BpcDateType, string> = {
  created: "Data de cadastro",
  first_contact: "Data do 1º contato",
  last_contact: "Data do último contato",
};

export interface BpcFormLead {
  form_lead_id: string;
  created_at: string;
  campaign_name: string;
  ad_name: string;
  form_name: string;
  is_organic: boolean;
  name: string;
  phone_raw: string;
  phone_normalized: string;
  estado_civil: string;
  filho_autista: string;
  laudo: string;
  renda: string;
  possui_advogado: string;
  lead_status: string;
  operator: string;
  tab: string;
  has_whatsapp: boolean;
  first_contact_by: "client" | "operator" | null;
  last_contact_at: string | null;
  first_contact_at: string | null;
  is_unviable: boolean;
}

export interface BpcMetrics {
  total: number;
  unviable: number;
  toCallNow: number;
  alreadyOnWhatsApp: number;
}

export interface BpcOperatorBreakdown {
  operator: string;
  tab: string;
  total: number;
  unviable: number;
  toCallNow: number;
  alreadyOnWhatsApp: number;
}

interface BpcResponse {
  metrics: BpcMetrics;
  leads: BpcFormLead[];
  byOperator: BpcOperatorBreakdown[];
}

const EMPTY_RESPONSE: BpcResponse = {
  metrics: { total: 0, unviable: 0, toCallNow: 0, alreadyOnWhatsApp: 0 },
  leads: [],
  byOperator: [],
};

async function fetchBpcSheet(params: {
  from: Date;
  to: Date;
  dateType: BpcDateType;
  instanceName?: string | null;
  source?: "unificada";
  spreadsheetId?: string;
}): Promise<BpcResponse> {
  const url = new URL(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bpc-sheets-metrics`,
  );
  url.searchParams.set("from", params.from.toISOString());
  url.searchParams.set("to", params.to.toISOString());
  url.searchParams.set("date_type", params.dateType);
  if (params.source) url.searchParams.set("source", params.source);
  if (params.instanceName) url.searchParams.set("instance_name", params.instanceName);
  if (params.spreadsheetId) url.searchParams.set("spreadsheet_id", params.spreadsheetId);
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  const json = await resp.json();
  if (!json.success) throw new Error(json.error || "Falha ao ler planilha");
  return {
    metrics: json.metrics,
    leads: json.leads || [],
    byOperator: json.byOperator || [],
  };
}

export function useBpcFormLeads(opts: {
  from: Date;
  to: Date;
  enabled?: boolean;
  instanceName?: string | null;
  dateType?: BpcDateType;
  /** "unificada" lê a aba BASE_UNIFICADA (operador vem da coluna origem_vendedor). */
  source?: "unificada";
  /**
   * ID da planilha do Google Sheets. Se omitido, usa a BPC-LOAS default (backwards compat).
   * Para funis com outra planilha (ex: Auxílio Acidente), passe explicitamente.
   */
  spreadsheetId?: string;
}) {
  const dateType: BpcDateType = opts.dateType ?? "created";
  const enabled = opts.enabled !== false;
  const queryClient = useQueryClient();

  // Chave estável (arredondada) — evita cache miss quando `from/to` são
  // recriadas em cada render mas representam o mesmo intervalo.
  const fromKey = opts.from.toISOString();
  const toKey = opts.to.toISOString();

  const queryKey = [
    "bpc-form-leads",
    fromKey,
    toKey,
    dateType,
    opts.source ?? "default",
    opts.instanceName ?? null,
    opts.spreadsheetId ?? "default",
  ] as const;

  const { data, isFetching, isLoading, error, refetch } = useQuery<BpcResponse>({
    queryKey,
    enabled,
    queryFn: () =>
      fetchBpcSheet({
        from: opts.from,
        to: opts.to,
        dateType,
        instanceName: opts.instanceName,
        source: opts.source,
        spreadsheetId: opts.spreadsheetId,
      }),
    // Cache generoso: mostra o valor antigo instantaneamente e revalida em background.
    staleTime: 60_000, // 1min "fresco" → mount subsequente não refaz fetch
    gcTime: 30 * 60_000, // mantém no cache 30min mesmo sem consumidores
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev, // segura o último valor durante refetch
  });

  const manualRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Invalidação targeted (útil pra outros componentes forçarem reload).
  void queryClient; // hook mantido pra futura utilidade

  const resp = data ?? EMPTY_RESPONSE;

  return {
    metrics: resp.metrics,
    leads: resp.leads,
    byOperator: resp.byOperator,
    loading: isLoading || (isFetching && !data),
    error: error ? (error as Error).message : null,
    refetch: manualRefetch,
  };
}
