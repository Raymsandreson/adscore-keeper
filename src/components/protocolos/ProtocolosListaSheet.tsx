// Lista dos protocolos administrativos INSS por trás dos números do card.
//
// Abre em painel lateral por cima da tela atual (nunca redireciona), a partir
// do botão "Ver protocolos" do ProtocolosDiaCard.
//
// DOIS FILTROS, EIXOS DIFERENTES:
//
//   1. Data de protocolo (protocol_date) — o eixo original do painel. Só entram
//      as linhas que TÊM data de protocolo. Medido em 11/08/2026: 417 de 891
//      linhas vivas; as outras nasceram de e-mail de status puro, sem a data no
//      corpo. Por isso os totais daqui NÃO batem com "na semana"/"no mês" do
//      card: aquele conta registrados (quando o e-mail chegou), este conta
//      protocolados (quando o requerimento foi protocolado).
//
//   2. Nº do caso/PREV (faixa "de … até") — pedido para responder "quantos
//      protocolos saíram entre o PREV 1200 e o PREV 1400". O número não mora
//      no protocolo: vem de legal_cases.case_number quando há caso, e de
//      leads.case_number quando só há lead. Os dois campos são texto digitado à
//      mão, então passam por src/lib/casoSequencia.ts antes de comparar.
//      Ligar a faixa desliga o filtro de data (senão a contagem sai truncada
//      pelo período que estava na tela) e passa a incluir também protocolo sem
//      data de protocolo — o aviso disso fica visível no cabeçalho do filtro.
//
// Lê a tabela direto (não a RPC tv_protocolos_dia): a RPC devolve só contagens
// de propósito, porque alimenta telão. Aqui aparece nome do segurado, então
// este painel não vai pra TV — só Visão Geral e Acompanhamento Processual.

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, FileText, Hash, Link2, Link2Off, Sparkles } from "lucide-react";
import { toast } from "sonner";

import ListPagination from "@/components/processes/ListPagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { authClient, db, ensureExternalSession } from "@/integrations/supabase";
import {
  dentroDaFaixa,
  descreverFaixa,
  faixaEstaAtiva,
  formatCasoSequencia,
  parseCasoSequencia,
  parseEntradaFaixa,
  FAMILIAS,
  type CasoSequencia,
  type FaixaCaso,
  type FamiliaCaso,
} from "@/lib/casoSequencia";
import { cloudFunctions } from "@/lib/functionRouter";
import type { ProtocoloParaVinculo } from "@/lib/inssVinculoCaso";
import { cn } from "@/lib/utils";

// Só baixa quando alguém clica numa linha: esse painel puxa o LeadEditDialog e
// o useLeads, e nenhum dos dois pesa no bundle da Visão Geral até lá.
const ProtocoloLeadPainel = lazy(() => import("@/components/protocolos/ProtocoloLeadPainel"));
// Idem para o diálogo de vínculo, que arrasta as buscas de caso/lead/contato.
const VincularCasoDialog = lazy(() => import("@/components/protocolos/VincularCasoDialog"));

/** Teto por consulta. Acima disso o painel avisa em vez de mentir por omissão. */
const TETO = 3000;
const PAGINA_DB = 1000;
const PAGE_SIZE = 25;
/** Anterior ao primeiro protocolo registrado (28/06/2022) — serve de "sem início". */
const DATA_ZERO = "2020-01-01";

interface ProtocoloRow {
  id: string;
  requerimento_number: string;
  nome_segurado: string | null;
  cpf_segurado: string | null;
  servico: string | null;
  benefit_type: string | null;
  benefit_number: string | null;
  current_status: string | null;
  resultado: string | null;
  protocol_date: string | null;
  created_at: string;
  case_id: string | null;
  lead_id: string | null;
}

interface VinculoInfo {
  /** Nº do caso/PREV como está gravado, para exibir. */
  numeroBruto: string | null;
  /** Nome do lead, quando houver — o rosto por trás do número. */
  nomeLead: string | null;
  /** Número normalizado, base do filtro por faixa. */
  sequencia: CasoSequencia | null;
}

const SEM_VINCULO: VinculoInfo = { numeroBruto: null, nomeLead: null, sequencia: null };

/** Hoje em America/Sao_Paulo, no formato YYYY-MM-DD. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function somaDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

/**
 * Formata YYYY-MM-DD sem passar por `new Date(iso)`: o construtor lê a string
 * como UTC e, no fuso do Brasil, devolveria o dia anterior. Protocolo do dia 11
 * aparecendo como 10 seria erro grave numa tela de produção.
 */
function fmtBr(iso?: string | null): string {
  if (!iso || iso.length < 10) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Descrição do que foi protocolado.
 *
 * `servico` é o campo limpo (386 de 417 preenchidos). `benefit_type` só entra
 * de reserva e amputado: o parser do e-mail deixou o resto do corpo grudado
 * nele ("AUXÍLIO-ACIDENTE Data do Protocolo : 10/08/2026 Unidade responsável :
 * SEÇÃO..."), então cortamos no primeiro rótulo e descartamos o que sobrar
 * grande demais pra ser nome de serviço.
 */
function descricaoDe(p: ProtocoloRow): string | null {
  const servico = (p.servico || "").trim();
  if (servico) return servico;

  const bruto = (p.benefit_type || "").trim();
  if (!bruto) return null;
  const cortado = bruto
    .split(/\s*(?:Data do Protocolo|Unidade respons|Status atual|Protocolo)\s*:/i)[0]
    .trim();
  if (!cortado || cortado.length > 60) return null;
  return cortado;
}

/** Mesma paleta de status da aba Processos INSS, pra não divergir na leitura. */
function statusCls(s?: string | null): string {
  const v = (s || "").toLowerCase();
  if (v.includes("protocol")) return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300";
  if (v.includes("exig")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (v.includes("cancel")) return "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  if (v.includes("inde")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (v.includes("conclu")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (v.includes("pend") || v.includes("anali")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

function rotuloStatus(p: ProtocoloRow): string {
  const s = p.current_status || "Sem status";
  if (/conclu/i.test(s) && p.resultado) {
    const mapa: Record<string, string> = {
      deferido: "Deferido",
      indeferido: "Indeferido",
      arquivado_decurso: "Arquivado por decurso",
    };
    return mapa[p.resultado] || s;
  }
  return s;
}

/** `.in()` em lotes: 300 uuids numa URL só estoura o limite de tamanho do GET. */
async function emLotes<T>(ids: string[], tamanho: number, fn: (lote: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += tamanho) {
    out.push(...(await fn(ids.slice(i, i + tamanho))));
  }
  return out;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ProtocolosListaSheet({ open, onOpenChange }: Props) {
  const [leadAlvo, setLeadAlvo] = useState<string | null>(null);
  // useCallback estável: o painel refaz a busca do lead quando o onClose troca
  // de identidade, e uma arrow inline trocaria a cada render daqui.
  const fecharLead = useCallback(() => setLeadAlvo(null), []);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
          {/* Conteúdo só monta quando abre: enquanto fechado não dispara consulta
              nenhuma no dashboard. */}
          {open && <Conteudo onAbrirLead={setLeadAlvo} />}
        </SheetContent>
      </Sheet>

      {/* Irmão do Sheet, não filho — é o arranjo já usado no ClosedLeadsSheet
          pra empilhar o painel do lead por cima de um sheet aberto. */}
      {leadAlvo && (
        <Suspense fallback={null}>
          <ProtocoloLeadPainel leadId={leadAlvo} onClose={fecharLead} />
        </Suspense>
      )}
    </>
  );
}

function Conteudo({ onAbrirLead }: { onAbrirLead: (leadId: string) => void }) {
  const hoje = useMemo(() => hojeSP(), []);
  const [de, setDe] = useState(() => somaDias(hoje, -29));
  const [ate, setAte] = useState(hoje);
  /** "periodo" = filtra por protocol_date; "qualquer" = sem recorte de data. */
  const [escopoData, setEscopoData] = useState<"periodo" | "qualquer">("periodo");
  const [rows, setRows] = useState<ProtocoloRow[]>([]);
  const [vinculos, setVinculos] = useState<Record<string, VinculoInfo>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState<ProtocoloParaVinculo | null>(null);
  const [autoVinculando, setAutoVinculando] = useState(false);

  // Faixa por nº do caso/PREV.
  const [familia, setFamilia] = useState<FamiliaCaso | "TODAS">("TODAS");
  const [faixaDe, setFaixaDe] = useState("");
  const [faixaAte, setFaixaAte] = useState("");
  /** Fila de conciliação: só o que chegou do INSS e não tem dono. */
  const [soSemVinculo, setSoSemVinculo] = useState(false);

  const intervaloInvalido = de > ate;

  useEffect(() => {
    (async () => {
      const { data } = await authClient.auth.getUser();
      setUserId(data.user?.id || null);
    })();
  }, []);

  const carregar = useCallback(async () => {
    if (escopoData === "periodo" && intervaloInvalido) return;
    setLoading(true);
    setErro(null);
    try {
      await ensureExternalSession();

      const colunas =
        "id, requerimento_number, nome_segurado, cpf_segurado, servico, benefit_type, benefit_number, current_status, resultado, protocol_date, created_at, case_id, lead_id";

      // Páginas de 1000 (teto do PostgREST) até o TETO: com a faixa por caso
      // ligada o recorte de data some, e uma consulta só não cobriria o acervo.
      const lista: ProtocoloRow[] = [];
      for (let inicio = 0; inicio < TETO; inicio += PAGINA_DB) {
        let q = db
          .from("inss_admin_processes" as any)
          .select(colunas)
          .is("deleted_at", null);
        if (escopoData === "periodo") {
          q = q.not("protocol_date", "is", null).gte("protocol_date", de).lte("protocol_date", ate);
        }
        const { data, error } = await q
          .order("protocol_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(inicio, Math.min(inicio + PAGINA_DB, TETO) - 1);
        if (error) throw error;
        const pagina = ((data || []) as unknown) as ProtocoloRow[];
        lista.push(...pagina);
        if (pagina.length < PAGINA_DB) break;
      }
      setRows(lista);

      // Rótulo do vínculo em 2 consultas em lote (uma por tabela), nunca uma
      // por linha: com 400 protocolos na tela isso viraria 400 requisições.
      const caseIds = Array.from(new Set(lista.map((r) => r.case_id).filter(Boolean))) as string[];
      const leadIds = Array.from(new Set(lista.map((r) => r.lead_id).filter(Boolean))) as string[];

      const [casos, leads] = await Promise.all([
        caseIds.length
          ? emLotes(caseIds, 100, async (lote) => {
              const { data: d } = await db
                .from("legal_cases" as any)
                .select("id, case_number")
                .in("id", lote);
              return (d || []) as any[];
            })
          : Promise.resolve([] as any[]),
        leadIds.length
          ? emLotes(leadIds, 100, async (lote) => {
              const { data: d } = await db
                .from("leads")
                .select("id, lead_name, case_number")
                .in("id", lote);
              return (d || []) as any[];
            })
          : Promise.resolve([] as any[]),
      ]);

      const mapa: Record<string, VinculoInfo> = {};
      for (const c of casos) {
        mapa[`case:${c.id}`] = {
          numeroBruto: c?.case_number || null,
          nomeLead: null,
          sequencia: parseCasoSequencia(c?.case_number),
        };
      }
      for (const l of leads) {
        mapa[`lead:${l.id}`] = {
          numeroBruto: l?.case_number || null,
          nomeLead: l?.lead_name || null,
          sequencia: parseCasoSequencia(l?.case_number),
        };
      }
      setVinculos(mapa);
    } catch (e: any) {
      console.error("[ProtocolosListaSheet]", e);
      setErro(e?.message || "Falha ao carregar os protocolos");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [de, ate, escopoData, intervaloInvalido]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /**
   * Vínculo da linha. O caso manda quando existe; o lead entra de reserva —
   * 277 dos 918 protocolos vivos (17/08/2026) têm lead e nenhum caso, e sem
   * essa reserva eles ficariam de fora de qualquer faixa.
   */
  const vinculoDe = useCallback(
    (p: ProtocoloRow): VinculoInfo => {
      const doCaso = p.case_id ? vinculos[`case:${p.case_id}`] : undefined;
      const doLead = p.lead_id ? vinculos[`lead:${p.lead_id}`] : undefined;
      if (!doCaso && !doLead) return SEM_VINCULO;
      return {
        numeroBruto: doCaso?.numeroBruto ?? doLead?.numeroBruto ?? null,
        nomeLead: doLead?.nomeLead ?? null,
        sequencia: doCaso?.sequencia ?? doLead?.sequencia ?? null,
      };
    },
    [vinculos],
  );

  const faixa: FaixaCaso = useMemo(() => {
    const entradaDe = parseEntradaFaixa(faixaDe);
    const entradaAte = parseEntradaFaixa(faixaAte);
    // Prefixo digitado no campo ("PREV 1200") manda no seletor: quem escreve o
    // número inteiro não deveria ter que reparar em dois controles.
    const familiaDigitada = entradaDe?.familia ?? entradaAte?.familia ?? null;
    const familiaEfetiva = familiaDigitada ?? (familia === "TODAS" ? null : familia);
    return { familia: familiaEfetiva, de: entradaDe?.numero ?? null, ate: entradaAte?.numero ?? null };
  }, [faixaDe, faixaAte, familia]);

  const filtroPorCasoAtivo = faixaEstaAtiva(faixa) || familia !== "TODAS";

  // Faixa ligada com período ligado devolveria uma contagem truncada sem dizer:
  // o recorte de data sai de cena assim que alguém filtra por número de caso.
  // Roda só na virada — clicar num preset depois disso volta a valer.
  useEffect(() => {
    if (filtroPorCasoAtivo) setEscopoData("qualquer");
  }, [filtroPorCasoAtivo]);

  // Órfão quase nunca tem data de protocolo lida do e-mail: com o recorte de
  // período ligado, a fila apareceria pela metade e ninguém saberia.
  useEffect(() => {
    if (soSemVinculo) setEscopoData("qualquer");
  }, [soSemVinculo]);

  const filtradas = useMemo(() => {
    const base = filtroPorCasoAtivo
      ? rows.filter((p) => dentroDaFaixa(vinculoDe(p).sequencia, faixa))
      : rows;
    if (!soSemVinculo) return base;
    // Fila do dia: sem caso E sem lead, do que chegou mais recentemente para o
    // mais antigo. Ordena por `created_at` (chegada do e-mail) e não por
    // `protocol_date`, que é justamente o que falta em boa parte dos órfãos —
    // ordenar por ela jogaria a fila do dia para o fim da lista.
    return base
      .filter((p) => !p.case_id && !p.lead_id)
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [rows, faixa, filtroPorCasoAtivo, vinculoDe, soSemVinculo]);

  const semCaso = useMemo(() => filtradas.filter((p) => !p.case_id).length, [filtradas]);
  // Tamanho da fila sobre TUDO que foi carregado, não sobre a lista já
  // filtrada: o número no botão não pode mudar de significado quando a pessoa
  // liga o próprio botão.
  const filaSemDono = useMemo(
    () => rows.filter((p) => !p.case_id && !p.lead_id).length,
    [rows],
  );
  const semVinculoNenhum = useMemo(
    () => filtradas.filter((p) => !p.case_id && !p.lead_id).length,
    [filtradas],
  );

  useEffect(() => {
    setPage(1);
  }, [de, ate, escopoData, faixaDe, faixaAte, familia, soSemVinculo]);

  const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paged = useMemo(
    () => filtradas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtradas, page],
  );

  const presets: { label: string; de: string; ate: string }[] = useMemo(
    () => [
      { label: "Hoje", de: hoje, ate: hoje },
      { label: "7 dias", de: somaDias(hoje, -6), ate: hoje },
      { label: "30 dias", de: somaDias(hoje, -29), ate: hoje },
      { label: "Este mês", de: `${hoje.slice(0, 7)}-01`, ate: hoje },
      { label: "Tudo", de: DATA_ZERO, ate: hoje },
    ],
    [hoje],
  );

  const limparFaixa = () => {
    setFaixaDe("");
    setFaixaAte("");
    setFamilia("TODAS");
  };

  /**
   * Roda o robô de vínculo do Railway (mesmo que o cron chama a cada 15 min):
   * ele tenta nº do requerimento, NB, custom field, CPF e nome para cada
   * protocolo sem dono, e promove a caso quem já tem lead com caso aberto.
   */
  const vincularAutomatico = async () => {
    setAutoVinculando(true);
    toast.info("Procurando dono para os protocolos sem caso…");
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>("match-inss-orphans", { body: {} });
      if (error) throw error;
      if (!j?.success) throw new Error(j?.error || "erro desconhecido");
      const promovidos = Number(j.promoted || 0);
      toast.success(
        `${j.matched || 0} de ${j.scanned || 0} protocolos sem dono vinculados` +
          (promovidos ? ` · ${promovidos} promovidos ao caso do lead` : ""),
      );
      carregar();
    } catch (e: any) {
      toast.error("Falha ao vincular automaticamente: " + (e?.message || ""));
    } finally {
      setAutoVinculando(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* pr-14: o botão de fechar do Sheet é absoluto no canto — o título não
          pode passar por baixo dele. */}
      <SheetHeader className="border-b px-5 pb-3 pt-5 pr-14 text-left space-y-1">
        <SheetTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          Protocolos administrativos INSS
        </SheetTitle>
        <SheetDescription className="text-xs">
          Por data de protocolo, do mais recente para o mais antigo. Dá para filtrar por faixa de
          nº do caso/PREV.
        </SheetDescription>
      </SheetHeader>

      <div className="border-b px-5 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((p) => {
            const ativo = escopoData === "periodo" && de === p.de && ate === p.ate;
            return (
              <Button
                key={p.label}
                size="sm"
                variant={ativo ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  setDe(p.de);
                  setAte(p.ate);
                  setEscopoData("periodo");
                }}
              >
                {p.label}
              </Button>
            );
          })}
          <Button
            size="sm"
            variant={escopoData === "qualquer" ? "default" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setEscopoData("qualquer")}
            title="Ignora a data e inclui também os requerimentos sem data de protocolo"
          >
            Qualquer data
          </Button>
          <Button
            size="sm"
            variant={soSemVinculo ? "default" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setSoSemVinculo((v) => !v)}
            title="Requerimentos que chegaram do INSS e não têm caso nem lead — ninguém é avisado enquanto ficarem assim"
          >
            Sem dono{filaSemDono > 0 ? ` (${filaSemDono})` : ""}
          </Button>
        </div>

        {escopoData === "periodo" && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span>Período:</span>
              <Input
                type="date"
                value={de}
                max={ate}
                onChange={(e) => setDe(e.target.value)}
                className="h-8 w-auto text-xs"
                aria-label="Data de protocolo inicial"
              />
              <span>até</span>
              <Input
                type="date"
                value={ate}
                min={de}
                onChange={(e) => setAte(e.target.value)}
                className="h-8 w-auto text-xs"
                aria-label="Data de protocolo final"
              />
            </div>
            {intervaloInvalido && (
              <p className="text-xs text-destructive">A data inicial está depois da final.</p>
            )}
          </>
        )}

        {/* Faixa por nº do caso/PREV */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Hash className="h-3.5 w-3.5 shrink-0" />
          <span>Nº do caso:</span>
          <Select
            value={familia}
            onValueChange={(v) => setFamilia(v as FamiliaCaso | "TODAS")}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Sequência do número de caso">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODAS">Todas</SelectItem>
              {FAMILIAS.map((f) => (
                <SelectItem key={f.valor} value={f.valor}>
                  {f.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={faixaDe}
            onChange={(e) => setFaixaDe(e.target.value)}
            placeholder="de (ex: PREV 1200)"
            className="h-8 w-[150px] text-xs"
            aria-label="Número de caso inicial"
          />
          <span>até</span>
          <Input
            value={faixaAte}
            onChange={(e) => setFaixaAte(e.target.value)}
            placeholder="até (ex: 1400)"
            className="h-8 w-[130px] text-xs"
            aria-label="Número de caso final"
          />
          {filtroPorCasoAtivo && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={limparFaixa}>
              limpar
            </Button>
          )}
        </div>

        {filtroPorCasoAtivo && (
          <p className="text-xs text-muted-foreground">
            Filtro por caso ignora o período e inclui requerimento sem data de protocolo. Protocolo
            sem caso e sem lead fica de fora — não há número para comparar.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {erro ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : filtradas.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {filtroPorCasoAtivo
              ? `Nenhum protocolo ${descreverFaixa(faixa)}.`
              : "Nenhum protocolo com data de protocolo nesse período."}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.length >= TETO && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Mostrando os {TETO} protocolos mais recentes. Estreite o período para ver o
                  restante.
                </span>
              </div>
            )}
            {paged.map((p) => {
              const descricao = descricaoDe(p);
              const vinculo = vinculoDe(p);
              // "sem caso vinculado" sai do DADO (case_id/lead_id nulos), não da
              // ausência do rótulo: se a busca de nomes falhar, o painel fica
              // sem o número do caso — mas não acusa órfão quem não é.
              const temCaso = Boolean(p.case_id);
              const temVinculo = Boolean(p.case_id || p.lead_id);
              const rotuloSequencia = formatCasoSequencia(vinculo.sequencia);
              const abrirLead = p.lead_id ? () => onAbrirLead(p.lead_id!) : undefined;

              return (
                <div key={p.id} className="flex items-start gap-2 rounded-lg border p-3">
                  <div
                    className={cn(
                      "min-w-0 flex-1 space-y-1",
                      abrirLead &&
                        "cursor-pointer rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    role={abrirLead ? "button" : undefined}
                    tabIndex={abrirLead ? 0 : undefined}
                    title={abrirLead ? "Abrir o lead vinculado" : undefined}
                    onClick={abrirLead}
                    onKeyDown={
                      abrirLead
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              abrirLead();
                            }
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold tabular-nums">
                        {p.protocol_date ? fmtBr(p.protocol_date) : "sem data de protocolo"}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        nº {p.requerimento_number}
                      </span>
                    </div>
                    <div className="truncate text-sm font-medium">
                      {p.nome_segurado || "(segurado não identificado)"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {descricao || "Serviço não informado no e-mail"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <Badge variant="outline" className={cn("text-[11px]", statusCls(p.current_status))}>
                        {rotuloStatus(p)}
                      </Badge>
                      {rotuloSequencia && (
                        <Badge variant="outline" className="text-[11px] font-mono">
                          {rotuloSequencia}
                        </Badge>
                      )}
                      {temVinculo ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {vinculo.nomeLead ||
                            vinculo.numeroBruto ||
                            (temCaso ? "caso vinculado" : "lead vinculado")}
                          {!temCaso && " · sem caso"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <Link2Off className="h-3 w-3" />
                          sem caso vinculado
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Fora do bloco clicável de propósito: botão dentro de área
                      clicável rouba o clique de quem queria abrir o lead. */}
                  {!temCaso && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 gap-1 text-xs"
                      onClick={() =>
                        setVinculando({
                          id: p.id,
                          requerimento_number: p.requerimento_number,
                          nome_segurado: p.nome_segurado,
                          cpf_segurado: p.cpf_segurado,
                          benefit_type: p.benefit_type,
                          benefit_number: p.benefit_number,
                          current_status: p.current_status,
                          resultado: p.resultado,
                          protocol_date: p.protocol_date,
                          created_at: p.created_at,
                          servico: p.servico,
                          lead_id: p.lead_id,
                          case_id: p.case_id,
                        })
                      }
                      title="Escolher o caso deste protocolo"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Vincular caso
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t px-5 py-3">
        <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {loading
              ? "Carregando…"
              : filtradas.length === 0
                ? "0 protocolos"
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtradas.length)} de ${filtradas.length} protocolo(s)` +
                  (filtroPorCasoAtivo ? ` ${descreverFaixa(faixa)}` : "")}
          </span>
          {!loading && semCaso > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              disabled={autoVinculando}
              onClick={vincularAutomatico}
              title="Tenta achar o caso pelo nº do requerimento, CPF e nome dos protocolos sem caso"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {autoVinculando ? "Vinculando…" : "Vincular automático"}
            </Button>
          )}
        </div>
        {!loading && filtradas.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {semCaso} sem caso vinculado
            {semVinculoNenhum > 0 && ` (${semVinculoNenhum} sem nem lead)`} ·{" "}
            {escopoData === "periodo"
              ? "só requerimentos com data de protocolo no e-mail do INSS"
              : "incluindo requerimentos sem data de protocolo"}
          </div>
        )}
      </div>

      {vinculando && (
        <Suspense fallback={null}>
          <VincularCasoDialog
            proc={vinculando}
            userId={userId}
            onClose={() => setVinculando(null)}
            onVinculado={() => carregar()}
          />
        </Suspense>
      )}
    </div>
  );
}
