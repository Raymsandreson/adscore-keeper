import { useEffect, useMemo, useState } from "react";
import { db, authClient } from "@/integrations/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  ExternalLink,
  Accessibility,
  ShieldAlert,
  AlertTriangle,
  Info,
  Download,
} from "lucide-react";
import { toast } from "sonner";

type CaseOption = {
  id: string;
  lead_id: string;
  case_number: string | null;
  title: string | null;
  status: string | null;
};

type AmbiguousCandidate = { id: string; name: string };

type Aviso = { campo: string; nivel: string; texto: string };

type DocItem = {
  file_id: string;
  name: string;
  tipo: string;
  mime: string;
  favorabilidade: "favoravel" | "adverso" | "neutro" | string;
  motivo: string | null;
  seguranca_bloqueado: boolean;
  sugestao_incluir: boolean;
};

type CartaoInss = {
  requerente: Record<string, unknown>;
  endereco: Record<string, unknown>;
  contato: Record<string, unknown>;
  composicao_familiar: unknown;
  renda_per_capita: number | null;
  procurador: Record<string, unknown>;
  bancario: Record<string, unknown>;
  dossie_pdf_url: string | null;
};

type AnaliseResult = {
  ok: true;
  modo: "analisar";
  protocolavel: boolean;
  avisos: Aviso[];
  faltando_docs: string[];
  documentos: DocItem[];
  gates: {
    cadunico_vencido: boolean | null;
    renda_acima_teto: boolean | null;
    renda_per_capita: number | null;
    endereco_vencido: boolean | null;
    docs_adversos: Array<{ nome: string; motivo: string }>;
  };
  cartao_inss: CartaoInss;
  cartao_faltando: string[];
  folder_id?: string;
};

type MontarResult = {
  ok: true;
  modo: "montar";
  pdf_url: string;
  qtd_incluidos: number;
  bloqueados_seguranca: string[];
};

type InvokeOutcome =
  | { tipo: "analisar"; data: AnaliseResult }
  | { tipo: "montar"; data: MontarResult }
  | { tipo: "ambiguo"; candidatos: AmbiguousCandidate[] }
  | { tipo: "erro"; mensagem: string };

async function chamar(payload: Record<string, unknown>): Promise<InvokeOutcome> {
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
  const d = data as AnaliseResult | MontarResult;
  if (d?.modo === "montar") return { tipo: "montar", data: d };
  return { tipo: "analisar", data: d as AnaliseResult };
}

export default function BpcAutistaPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CaseOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CaseOption | null>(null);

  const [analisando, setAnalisando] = useState(false);
  const [montando, setMontando] = useState(false);
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  const [ambiguous, setAmbiguous] = useState<AmbiguousCandidate[] | null>(null);

  const [analise, setAnalise] = useState<AnaliseResult | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [incluidos, setIncluidos] = useState<Record<string, boolean>>({});
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

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

  function resetTriagem() {
    setAnalise(null);
    setIncluidos({});
    setPdfUrl(null);
    setAmbiguous(null);
    setFolderId(null);
  }

  async function handleAnalisar(payload?: Record<string, unknown>) {
    if (!selected && !payload) return;
    setAnalisando(true);
    setAmbiguous(null);
    setAnalise(null);
    setPdfUrl(null);
    const body = payload ?? { lead_id: selected!.lead_id, case_name: selected!.title };
    const out = await chamar(body);
    setAnalisando(false);
    if (out.tipo === "analisar") {
      setAnalise(out.data);
      // folder_id não vem no payload da analisar; guardamos via candidato ou recuperamos no montar via case_name/lead_id
      const seed: Record<string, boolean> = {};
      for (const d of out.data.documentos) {
        seed[d.file_id] = d.sugestao_incluir && !d.seguranca_bloqueado;
      }
      setIncluidos(seed);
      // se viemos de um candidato (folder_id), persiste
      if (payload && typeof (payload as any).folder_id === "string") {
        setFolderId((payload as any).folder_id);
      }
    } else if (out.tipo === "ambiguo") {
      setAmbiguous(out.candidatos);
    } else if (out.tipo === "montar") {
      // não deveria acontecer aqui
      setPdfUrl(out.data.pdf_url);
    } else {
      toast.error(out.mensagem || "Falha na triagem");
    }
  }

  async function handleMontar() {
    if (!analise || !selected) return;
    const ids = Object.entries(incluidos)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (ids.length === 0) {
      toast.error("Selecione pelo menos um documento.");
      return;
    }
    setMontando(true);
    const body: Record<string, unknown> = {
      lead_id: selected.lead_id,
      case_name: selected.title,
      incluir_ids: ids,
    };
    if (folderId) body.folder_id = folderId;
    const out = await chamar(body);
    setMontando(false);
    if (out.tipo === "montar") {
      setPdfUrl(out.data.pdf_url);
      toast.success(`Dossiê montado com ${out.data.qtd_incluidos} documento(s).`);
    } else if (out.tipo === "erro") {
      toast.error(out.mensagem);
    }
  }

  function toggleDoc(id: string, blocked: boolean) {
    if (blocked) return;
    setIncluidos((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleBaixarDossiePdf() {
    if (!analise || !selected) return;
    const ids = new Set(
      Object.entries(incluidos).filter(([, v]) => v).map(([k]) => k),
    );
    const documentos = analise.documentos
      .filter((d) => ids.has(d.file_id))
      .map((d) => ({ file_id: d.file_id, name: d.name, mime: d.mime, tipo: d.tipo }));
    if (documentos.length === 0) return;

    setBaixandoPdf(true);
    const toastId = toast.loading("Montando dossiê...");
    try {
      // A função vive no Supabase CLOUD porque depende das secrets do connector
      // Google Drive (LOVABLE_API_KEY + GOOGLE_DRIVE_API_KEY), que só existem lá.
      const supabaseUrl = "https://gliigkupoebmlbwyvijp.supabase.co";
      const anonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38";
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? anonKey;

      const resp = await fetch(`${supabaseUrl}/functions/v1/montar-dossie-pdf-unico`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },

        body: JSON.stringify({ documentos }),
      });

      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("application/pdf")) {
        // Erro de negócio → JSON
        const res = await resp.json().catch(() => ({}));
        const msg = res?.erro || "Falha ao montar o dossiê.";
        if (Array.isArray(res?.falhas) && res.falhas.length > 0) {
          const lista = res.falhas.map((f: any) => `• ${f.nome}: ${f.motivo}`).join("\n");
          toast.error(msg, { id: toastId, description: lista, duration: 12000 });
        } else {
          toast.error(msg, { id: toastId, duration: 8000 });
        }
        return;
      }

      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const cpfRaw = String(
        (analise.cartao_inss?.requerente as any)?.cpf ?? "",
      ).replace(/\D/g, "") || "sem_cpf";
      const prev = (selected.case_number || "sem_prev").replace(/[^A-Za-z0-9_-]/g, "_");
      const filename = `dossie_${prev}_${cpfRaw}.pdf`;
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);

      const paginas = resp.headers.get("x-dossie-paginas") ?? "?";
      const docs = resp.headers.get("x-dossie-documentos") ?? documentos.length;
      const mb = resp.headers.get("x-dossie-tamanho-mb") ?? "?";
      toast.success(
        `Dossiê com ${docs} documentos, ${paginas} páginas, ${mb} MB. Baixado.`,
        { id: toastId, duration: 8000 },
      );
    } catch (e: any) {
      toast.error(e?.message || "Falha ao baixar dossiê", { id: toastId });
    } finally {
      setBaixandoPdf(false);
    }
  }


  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    const parts: string[] = [selected.title ?? "(sem título)"];
    if (selected.case_number) parts.push(`(${selected.case_number})`);
    return parts.join(" ");
  }, [selected]);

  const qtdSelecionados = useMemo(
    () => Object.values(incluidos).filter(Boolean).length,
    [incluidos],
  );

  const avisoIcon = (nivel: string) => {
    if (nivel === "alto") return <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />;
    if (nivel === "medio") return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />;
    return <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />;
  };

  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Accessibility className="h-6 w-6" /> BPC – Autista
        </h1>
        <p className="text-sm text-muted-foreground">
          Lê a pasta do Drive, tria cada documento com IA e te deixa escolher o que entra no dossiê único do INSS. O
          lançamento no portal é manual.
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
                resetTriagem();
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

          <Button onClick={() => handleAnalisar()} disabled={!selected || analisando}>
            {analisando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {analise ? "Re-analisar pasta" : "Analisar pasta do Drive"}
          </Button>

          {analisando && (
            <p className="text-sm text-muted-foreground">
              Lendo a pasta no Drive e triando cada documento com IA… (pode levar até 1 minuto)
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
                onClick={() =>
                  handleAnalisar({
                    folder_id: c.id,
                    lead_id: selected?.lead_id,
                    case_name: selected?.title,
                  })
                }
                disabled={analisando}
              >
                {c.name}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {analise && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Recomendação da triagem</CardTitle>
              {analise.protocolavel ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Pronto para protocolar
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Revisar antes de protocolar
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {analise.avisos.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-1">Avisos</div>
                  <ul className="space-y-1 text-sm">
                    {analise.avisos.map((a, i) => (
                      <li key={i} className="flex gap-2">
                        {avisoIcon(a.nivel)}
                        <span>
                          <span className="text-muted-foreground">[{a.campo}]</span> {a.texto}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analise.faltando_docs.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-amber-700 mb-1">Documentos faltando</div>
                  <ul className="space-y-1 text-sm">
                    {analise.faltando_docs.map((d, i) => (
                      <li key={i}>• {d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analise.cartao_faltando.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Campos do cartão INSS não preenchidos: {analise.cartao_faltando.join(", ")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">
                2. Escolher documentos do dossiê
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{qtdSelecionados} selecionado(s)</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBaixarDossiePdf}
                  disabled={qtdSelecionados === 0 || baixandoPdf}
                >
                  {baixandoPdf ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  {baixandoPdf ? "Montando dossiê..." : "Baixar dossiê (PDF)"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {analise.documentos.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum documento encontrado na pasta.</p>
              )}
              {analise.documentos.map((d) => {
                const checked = !!incluidos[d.file_id];
                const blocked = d.seguranca_bloqueado;
                const corFav =
                  d.favorabilidade === "favoravel"
                    ? "text-emerald-600"
                    : d.favorabilidade === "adverso"
                      ? "text-destructive"
                      : "text-muted-foreground";
                return (
                  <label
                    key={d.file_id}
                    className={`flex items-start gap-3 p-2 rounded-md border ${
                      blocked ? "bg-destructive/5 cursor-not-allowed" : "hover:bg-accent cursor-pointer"
                    }`}
                  >
                    <Checkbox
                      checked={checked && !blocked}
                      disabled={blocked}
                      onCheckedChange={() => toggleDoc(d.file_id, blocked)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{d.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {d.tipo}
                        </Badge>
                        <span className={`text-[10px] uppercase ${corFav}`}>{d.favorabilidade}</span>
                        {blocked && (
                          <Badge variant="destructive" className="text-[10px]">
                            <ShieldAlert className="h-3 w-3 mr-1" /> bloqueado (sensível)
                          </Badge>
                        )}
                      </div>
                      {d.motivo && (
                        <div className="text-xs text-muted-foreground mt-0.5">{d.motivo}</div>
                      )}
                    </div>
                  </label>
                );
              })}

              <div className="pt-2 flex items-center gap-3">
                <Button onClick={handleMontar} disabled={montando || qtdSelecionados === 0}>
                  {montando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                  Montar dossiê único (PDF)
                </Button>
                {pdfUrl && (
                  <>
                    <Button asChild variant="outline">
                      <a href={pdfUrl} target="_blank" rel="noreferrer">
                        Abrir PDF <ExternalLink className="h-3.5 w-3.5 ml-2" />
                      </a>
                    </Button>
                    <Button
                      variant="default"
                      onClick={handleBaixarDossiePdf}
                      disabled={baixandoPdf || qtdSelecionados === 0}
                    >
                      {baixandoPdf ? (
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-2" />
                      )}
                      {baixandoPdf ? "Baixando..." : "Baixar PDF"}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <footer className="text-xs text-muted-foreground border-t pt-4">
        Esta ferramenta NÃO acessa o portal do INSS. Login, agendamento de perícia e protocolo são feitos manualmente
        pelo advogado.
      </footer>
    </div>
  );
}
