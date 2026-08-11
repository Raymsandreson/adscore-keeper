// Lista dos protocolos administrativos INSS por trás dos números do card.
//
// Abre em painel lateral por cima da tela atual (nunca redireciona), a partir
// do botão "Ver protocolos" do ProtocolosDiaCard.
//
// DECISÃO DE FONTE — a lista é por DATA DE PROTOCOLO (protocol_date), não por
// data de chegada do comprovante (created_at). Consequência que precisa ficar
// visível pra quem lê: só entram aqui as linhas que TÊM data de protocolo.
// Medido em 11/08/2026: 417 de 891 linhas vivas. As outras nasceram de e-mail
// de status puro, sem a data no corpo — existem na aba Processos INSS, mas não
// têm onde cair numa linha do tempo de protocolo. O rodapé do painel diz isso.
//
// Por isso os totais daqui NÃO batem com "na semana"/"no mês" do card: aqueles
// contam registrados (quando o e-mail chegou), este conta protocolados (quando
// o requerimento foi protocolado). Ver src/lib/protocolosDia.ts.
//
// Lê a tabela direto (não a RPC tv_protocolos_dia): a RPC devolve só contagens
// de propósito, porque alimenta telão. Aqui aparece nome do segurado, então
// este painel não vai pra TV — só Visão Geral e Acompanhamento Processual.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, FileText, Link2Off } from "lucide-react";

import ListPagination from "@/components/processes/ListPagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { db, ensureExternalSession } from "@/integrations/supabase";
import { cn } from "@/lib/utils";

/** Teto por consulta. Acima disso o painel avisa em vez de mentir por omissão. */
const LIMITE = 500;
const PAGE_SIZE = 25;
/** Anterior ao primeiro protocolo registrado (28/06/2022) — serve de "sem início". */
const DATA_ZERO = "2020-01-01";

interface ProtocoloRow {
  id: string;
  requerimento_number: string;
  nome_segurado: string | null;
  servico: string | null;
  benefit_type: string | null;
  current_status: string | null;
  resultado: string | null;
  protocol_date: string;
  created_at: string;
  case_id: string | null;
  lead_id: string | null;
}

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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
        {/* Conteúdo só monta quando abre: enquanto fechado não dispara consulta
            nenhuma no dashboard. */}
        {open && <Conteudo />}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo() {
  const hoje = useMemo(() => hojeSP(), []);
  const [de, setDe] = useState(() => somaDias(hoje, -29));
  const [ate, setAte] = useState(hoje);
  const [rows, setRows] = useState<ProtocoloRow[]>([]);
  const [vinculos, setVinculos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const intervaloInvalido = de > ate;

  const carregar = useCallback(async () => {
    if (intervaloInvalido) return;
    setLoading(true);
    setErro(null);
    try {
      await ensureExternalSession();
      const { data, error } = await db
        .from("inss_admin_processes" as any)
        .select(
          "id, requerimento_number, nome_segurado, servico, benefit_type, current_status, resultado, protocol_date, created_at, case_id, lead_id",
        )
        .is("deleted_at", null)
        .not("protocol_date", "is", null)
        .gte("protocol_date", de)
        .lte("protocol_date", ate)
        .order("protocol_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(LIMITE);
      if (error) throw error;

      const lista = ((data || []) as unknown) as ProtocoloRow[];
      setRows(lista);

      // Rótulo do vínculo em 2 consultas em lote (uma por tabela), nunca uma
      // por linha: com 400 protocolos na tela isso viraria 400 requisições.
      const caseIds = Array.from(new Set(lista.map((r) => r.case_id).filter(Boolean))) as string[];
      const leadIds = Array.from(
        new Set(lista.filter((r) => !r.case_id).map((r) => r.lead_id).filter(Boolean)),
      ) as string[];

      const mapa: Record<string, string> = {};
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
                .from("leads" as any)
                .select("id, lead_name")
                .in("id", lote);
              return (d || []) as any[];
            })
          : Promise.resolve([] as any[]),
      ]);
      for (const c of casos) if (c?.case_number) mapa[`case:${c.id}`] = c.case_number;
      for (const l of leads) if (l?.lead_name) mapa[`lead:${l.id}`] = l.lead_name;
      setVinculos(mapa);
    } catch (e: any) {
      console.error("[ProtocolosListaSheet]", e);
      setErro(e?.message || "Falha ao carregar os protocolos");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [de, ate, intervaloInvalido]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setPage(1);
  }, [de, ate]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paged = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
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
          Por data de protocolo, do mais recente para o mais antigo.
        </SheetDescription>
      </SheetHeader>

      <div className="border-b px-5 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((p) => {
            const ativo = de === p.de && ate === p.ate;
            return (
              <Button
                key={p.label}
                size="sm"
                variant={ativo ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  setDe(p.de);
                  setAte(p.ate);
                }}
              >
                {p.label}
              </Button>
            );
          })}
        </div>
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
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhum protocolo com data de protocolo nesse período.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.length === LIMITE && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Mostrando os {LIMITE} protocolos mais recentes do período. Estreite as datas
                  para ver o restante.
                </span>
              </div>
            )}
            {paged.map((p) => {
              const descricao = descricaoDe(p);
              // "sem caso vinculado" sai do DADO (case_id/lead_id nulos), não da
              // ausência do rótulo: se a busca de nomes falhar, o painel fica
              // sem o número do caso — mas não acusa órfão quem não é.
              const temVinculo = Boolean(p.case_id || p.lead_id);
              const rotuloVinculo = p.case_id
                ? vinculos[`case:${p.case_id}`]
                : p.lead_id
                  ? vinculos[`lead:${p.lead_id}`]
                  : null;
              return (
                <div key={p.id} className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold tabular-nums">
                      {fmtBr(p.protocol_date)}
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
                    {temVinculo ? (
                      <span className="text-xs text-muted-foreground">
                        {rotuloVinculo || (p.case_id ? "caso vinculado" : "lead vinculado")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <Link2Off className="h-3 w-3" />
                        sem caso vinculado
                      </span>
                    )}
                  </div>
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
              : rows.length === 0
                ? "0 protocolos"
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} de ${rows.length} protocolo(s)`}
          </span>
          <span className="text-right">
            Só entram requerimentos com data de protocolo no e-mail do INSS.
          </span>
        </div>
      </div>
    </div>
  );
}
