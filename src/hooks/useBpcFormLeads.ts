import { useCallback, useEffect, useState } from "react";
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
  first_contact_at: string | null;
  last_contact_at: string | null;
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
  const [metrics, setMetrics] = useState<BpcMetrics>({
    total: 0,
    unviable: 0,
    toCallNow: 0,
    alreadyOnWhatsApp: 0,
  });
  const [leads, setLeads] = useState<BpcFormLead[]>([]);
  const [byOperator, setByOperator] = useState<BpcOperatorBreakdown[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateType: BpcDateType = opts.dateType ?? "created";

  const fetchData = useCallback(async () => {
    if (opts.enabled === false) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bpc-sheets-metrics`,
      );
      url.searchParams.set("from", opts.from.toISOString());
      url.searchParams.set("to", opts.to.toISOString());
      url.searchParams.set("date_type", dateType);
      if (opts.source) url.searchParams.set("source", opts.source);
      if (opts.instanceName) url.searchParams.set("instance_name", opts.instanceName);
      if (opts.spreadsheetId) url.searchParams.set("spreadsheet_id", opts.spreadsheetId);
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error || "Falha ao ler planilha");
      setMetrics(json.metrics);
      setLeads(json.leads || []);
      setByOperator(json.byOperator || []);
    } catch (e: any) {
      console.error("[useBpcFormLeads]", e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [opts.from.getTime(), opts.to.getTime(), opts.enabled, opts.instanceName, dateType, opts.source, opts.spreadsheetId]);

  useEffect(() => {
    fetchData();
    if (opts.enabled === false) return;
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return { metrics, leads, byOperator, loading, error, refetch: fetchData };
}
