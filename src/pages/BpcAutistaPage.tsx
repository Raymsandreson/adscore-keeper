import { useEffect, useMemo, useState } from "react";
import { db } from "@/integrations/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, FileText, ExternalLink, Accessibility } from "lucide-react";
import { toast } from "sonner";

type CaseOption = {
  id: string;
  lead_id: string;
  case_number: string | null;
  title: string | null;
  status: string | null;
};

type AmbiguousCandidate = { id: string; name: string };

type DossieResult = {
  ok: true;
  protocolavel: boolean;
  pdf_url: string;
  gates: {
    cadunico_vencido: boolean | null;
    renda_acima_teto: boolean | null;
    renda_per_capita: number | null;
    endereco_vencido: boolean | null;
    docs_adversos: Array<{ nome: string; motivo: string }>;
  };
  agencias_ativo: boolean;
  agencias?: Array<{ nome: string; endereco?: string }>;
  incluidos: string[];
  excluidos: string[];
};

type InvokeOutcome =
  | { tipo: "ok"; data: DossieResult }
  | { tipo: "ambiguo"; candidatos: AmbiguousCandidate[] }
  | { tipo: "erro"; mensagem: string };

async function montarDossie(payload: Record<string, unknown>): Promise<InvokeOutcome> {
  const { data, error } = await db.functions.invoke("montar-dossie-inss", { body: payload });
  if (error) {
    let corpo: any = null;
    try {
      corpo = await (error as any).context?.json?.();
    } catch {
      /* noop */
    }
    if (corpo?.erro === "pasta_ambigua") {
      return { tipo: "ambiguo", candidatos: corpo.candidatos ?? [] };
    }
    return { tipo: "erro", mensagem: corpo?.erro || error.message };
  }
  return { tipo: "ok", data: data as DossieResult };
}

export default function BpcAutistaPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CaseOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CaseOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [ambiguous, setAmbiguous] = useState<AmbiguousCandidate[] | null>(null);
  const [result, setResult] = useState<DossieResult | null>(null);

  // Busca casos em legal_cases (debounced)
  useEffect(() => {
    if (!query || query.length < 2 || selected) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await db
          .from("legal_cases")
          .select("id, lead_id, case_number, title, status")
          .or(`title.ilike.%${query}%,case_number.ilike.%${query}%`)
          .not("lead_id", "is", null)
          .order("title", { ascending: true })
          .limit(20);
        if (error) throw error;
        setResults((data ?? []) as CaseOption[]);
      } catch (e: any) {
        toast.error("Erro ao buscar casos: " + e.message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, selected]);

  async function handleMontar(payload?: Record<string, unknown>) {
    if (!selected) return;
    setLoading(true);
    setAmbiguous(null);
    setResult(null);
    const body = payload ?? { lead_id: selected.lead_id, case_name: selected.title };
    const out = await montarDossie(body);
    setLoading(false);
    if (out.tipo === "ok") setResult(out.data);
    else if (out.tipo === "ambiguo") setAmbiguous(out.candidatos);
    else toast.error(out.mensagem || "Falha ao montar o dossiê");
  }

  const gates = result?.gates;
  const bloqueios = useMemo(() => {
    if (!gates) return [];
    const out: string[] = [];
    if (gates.cadunico_vencido === true) out.push("CadÚnico vencido (atualizar no CRAS)");
    if (gates.renda_acima_teto === true)
      out.push(`Renda per capita acima do teto: R$ ${gates.renda_per_capita ?? "?"} (limite R$ 405,25)`);
    if (gates.endereco_vencido === true) out.push("Comprovante de endereço vencido (>3 meses)");
    for (const d of gates.docs_adversos ?? []) out.push(`Documento adverso: ${d.nome} — ${d.motivo}`);
    return out;
  }, [gates]);

  const indeterminados = useMemo(() => {
    if (!gates) return [];
    const out: string[] = [];
    if (gates.cadunico_vencido === null) out.push("CadÚnico: não foi possível avaliar");
    if (gates.renda_acima_teto === null) out.push("Renda per capita: não foi possível avaliar");
    if (gates.endereco_vencido === null) out.push("Endereço: não foi possível avaliar");
    return out;
  }, [gates]);

  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    const parts: string[] = [selected.title ?? "(sem título)"];
    if (selected.case_number) parts.push(`(${selected.case_number})`);
    return parts.join(" ");
  }, [selected]);

  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Accessibility className="h-6 w-6" /> BPC – Autista
        </h1>
        <p className="text-sm text-muted-foreground">
          Monta o dossiê do INSS a partir da pasta do Drive e roda a triagem de elegibilidade. O lançamento no INSS é
          manual, feito pelo advogado.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Selecionar o caso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Input
              placeholder="Título do caso ou número PREV"
              value={selected ? selectedLabel : query}
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value);
              }}
            />
            {!selected && results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-64 overflow-auto">
                {results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                    onClick={() => {
                      setSelected(c);
                      setResults([]);
                      setQuery("");
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.title || "(sem título)"}</span>
                      {c.status && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          {c.status}
                        </Badge>
                      )}
                    </div>
                    {c.case_number && (
                      <div className="text-xs text-muted-foreground">{c.case_number}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {searching && <p className="text-xs text-muted-foreground mt-1">Buscando…</p>}
          </div>

          <Button onClick={() => handleMontar()} disabled={!selected || loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Montar Dossiê
          </Button>

          {loading && (
            <p className="text-sm text-muted-foreground">
              Lendo a pasta no Drive e triando os documentos… (pode levar até 1 minuto)
            </p>
          )}
        </CardContent>
      </Card>

      {ambiguous && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-base">Encontramos várias pastas — escolha a correta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ambiguous.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 border rounded-md hover:bg-accent text-sm"
                onClick={() => handleMontar({ folder_id: c.id })}
                disabled={loading}
              >
                {c.name}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Resultado da triagem</CardTitle>
              {result.protocolavel ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Pronto para anexar
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Bloqueado — revisar antes de protocolar
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {bloqueios.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-destructive mb-1">Bloqueios</div>
                  <ul className="space-y-1 text-sm">
                    {bloqueios.map((b, i) => (
                      <li key={i} className="flex gap-2">
                        <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {indeterminados.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Não avaliado</div>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {indeterminados.map((b, i) => (
                      <li key={i}>• {b}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Button asChild variant="default">
                <a href={result.pdf_url} target="_blank" rel="noreferrer">
                  <FileText className="h-4 w-4 mr-2" />
                  Abrir dossiê único (PDF)
                  <ExternalLink className="h-3.5 w-3.5 ml-2" />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.incluidos.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-emerald-600 mb-1">Incluídos</div>
                  <ul className="space-y-1 text-sm">
                    {result.incluidos.map((n, i) => (
                      <li key={i} className="flex gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.excluidos.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-destructive mb-1">Excluídos</div>
                  <ul className="space-y-1 text-sm">
                    {result.excluidos.map((n, i) => (
                      <li key={i} className="flex gap-2 line-through text-destructive">
                        <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {result.agencias_ativo && result.agencias && result.agencias.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Agências (perícia)</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {result.agencias.map((a, i) => (
                    <li key={i}>
                      <span className="font-medium">{a.nome}</span>
                      {a.endereco ? <span className="text-muted-foreground"> — {a.endereco}</span> : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <footer className="text-xs text-muted-foreground border-t pt-4">
        Esta ferramenta NÃO acessa o portal do INSS. Login, agendamento de perícia e protocolo são feitos manualmente
        pelo advogado.
      </footer>
    </div>
  );
}
