import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Scale, Gavel, Calendar, Users, UserCheck, FileText, ExternalLink, Clock } from "lucide-react";

interface ParsedPjeEmail {
  isPje: boolean;
  numero?: string;
  classe?: string;
  orgao?: string;
  dataAutuacao?: string;
  autor?: string;
  advogadosAutor?: string[];
  reu?: string;
  advogadosReu?: string[];
  eventos?: { data: string; descricao: string }[];
  links?: string[];
  rodape?: string;
}

/** Extrai um valor entre `label` e o próximo dos `nextLabels`. */
function between(text: string, label: string, nextLabels: string[]): string | undefined {
  const re = new RegExp(
    `${label}\\s*:?\\s*([\\s\\S]*?)(?=\\s+(?:${nextLabels.join("|")})\\b|$)`,
    "i",
  );
  const m = text.match(re);
  return m ? m[1].trim().replace(/\s+/g, " ") : undefined;
}

function parseAdvogados(raw?: string): string[] {
  if (!raw) return [];
  // "NOME, OAB: 1234 NOME2, OAB: 5678" → split entre "OAB: XXXX " e o nome seguinte
  const parts = raw.split(/(?<=OAB:\s*\d{1,6})\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseEventos(raw?: string): { data: string; descricao: string }[] {
  if (!raw) return [];
  // Cada evento começa com "DD/MM/AAAA HH:MM "
  const re = /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\s+([^]*?)(?=\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}|$)/g;
  const out: { data: string; descricao: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push({ data: m[1].trim(), descricao: m[2].trim().replace(/\s+/g, " ") });
  }
  return out;
}

/** Decodifica entidades HTML comuns (numéricas e nomeadas). */
function decodeHtmlEntities(input: string): string {
  if (!input) return input;
  let s = input
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  const map: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
    atilde: "ã", otilde: "õ", ntilde: "ñ", Atilde: "Ã", Otilde: "Õ", Ntilde: "Ñ",
    acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
    Acirc: "Â", Ecirc: "Ê", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û",
    agrave: "à", Agrave: "À", ccedil: "ç", Ccedil: "Ç",
    ordf: "ª", ordm: "º", deg: "°", middot: "·", hellip: "…",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    laquo: "«", raquo: "»", euro: "€", copy: "©", reg: "®", trade: "™",
  };
  s = s.replace(/&([a-zA-Z]+);/g, (m, name) => (map[name] ?? m));
  return s;
}

export function parsePjeEmail(body: string): ParsedPjeEmail {
  if (!body) return { isPje: false };
  const decoded = decodeHtmlEntities(body);
  const compact = decoded.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const isPje = /Número do Processo|Tribunal Regional|consultaprocessual|push|Polo Ativo|Polo Passivo/i.test(compact);
  if (!isPje) return { isPje: false };

  const labels = [
    "Número do Processo",
    "Classe Judicial",
    "Órgão Julgador",
    "Órgão",
    "Data de Autuação",
    "Assunto",
    "Data - Movimento",
    "Polo Ativo",
    "Polo Passivo",
    "Autor",
    "Advogados do Autor",
    "Réu",
    "Advogados do Réu",
    "Eventos",
    "Para acessar",
    "ATENÇÃO",
  ];
  // gera lista de "próximos labels" para cada chamada
  const next = (cur: string) => labels.filter((l) => l !== cur).map((l) => l.replace(/ /g, "\\s+"));

  const numero = between(compact, "Número do Processo", next("Número do Processo"));
  const classe = between(compact, "Classe Judicial", next("Classe Judicial"));
  const orgao = between(compact, "Órgão Julgador", next("Órgão Julgador"))
    ?? between(compact, "Órgão", next("Órgão"));
  const dataAutuacao = between(compact, "Data de Autuação", next("Data de Autuação"));
  const autor = between(compact, "Polo Ativo", next("Polo Ativo"))
    ?? between(compact, "Autor", next("Autor"));
  const advAutorRaw = between(compact, "Advogados do Autor", next("Advogados do Autor"));
  const reu = between(compact, "Polo Passivo", next("Polo Passivo"))
    ?? between(compact, "Réu", next("Réu"));
  const advReuRaw = between(compact, "Advogados do Réu", next("Advogados do Réu"));
  const eventosRaw = between(compact, "Eventos", next("Eventos"));

  const links = Array.from(
    new Set((compact.match(/https?:\/\/[^\s]+/gi) || []).map((l) => l.replace(/[.,;]+$/, ""))),
  );

  const rodapeIdx = compact.search(/Para acessar|favor não o responda|ATENÇÃO/i);
  const rodape = rodapeIdx > 0 ? compact.slice(rodapeIdx).replace(/\s+/g, " ").trim() : undefined;

  return {
    isPje: true,
    numero,
    classe,
    orgao,
    dataAutuacao,
    autor,
    advogadosAutor: parseAdvogados(advAutorRaw),
    reu,
    advogadosReu: parseAdvogados(advReuRaw),
    eventos: parseEventos(eventosRaw),
    links,
    rodape,
  };
}

function Field({ icon: Icon, label, value }: { icon: any; label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
        <div className="text-sm text-foreground break-words">{value}</div>
      </div>
    </div>
  );
}

interface PjePushEmailViewProps {
  body: string;
  /** Quando não é PJe (ou falha o parse), renderiza este fallback. */
  fallback?: React.ReactNode;
}

export function PjePushEmailView({ body, fallback }: PjePushEmailViewProps) {
  const parsed = parsePjeEmail(body);
  if (!parsed.isPje) {
    return (
      fallback ?? (
        <pre className="whitespace-pre-wrap text-sm font-sans text-foreground">{body}</pre>
      )
    );
  }

  return (
    <div className="space-y-4">
      {/* Identificação */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field icon={FileText} label="Nº do Processo" value={parsed.numero} />
          <Field icon={Calendar} label="Data de Autuação" value={parsed.dataAutuacao} />
          <Field icon={Scale} label="Classe Judicial" value={parsed.classe} />
          <Field icon={Gavel} label="Órgão Julgador" value={parsed.orgao} />
        </div>
      </div>

      {/* Partes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Users className="h-3.5 w-3.5 text-primary" />
            Autor
          </div>
          {parsed.autor && <div className="text-sm">{parsed.autor}</div>}
          {parsed.advogadosAutor && parsed.advogadosAutor.length > 0 && (
            <div className="space-y-1 pt-1 border-t">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1">
                <UserCheck className="h-3 w-3" /> Advogados
              </div>
              <div className="flex flex-wrap gap-1">
                {parsed.advogadosAutor.map((a, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] font-normal">{a}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Users className="h-3.5 w-3.5 text-amber-600" />
            Réu
          </div>
          {parsed.reu && <div className="text-sm">{parsed.reu}</div>}
          {parsed.advogadosReu && parsed.advogadosReu.length > 0 && (
            <div className="space-y-1 pt-1 border-t">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1">
                <UserCheck className="h-3 w-3" /> Advogados
              </div>
              <div className="flex flex-wrap gap-1">
                {parsed.advogadosReu.map((a, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-normal">{a}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Eventos / movimentações */}
      {parsed.eventos && parsed.eventos.length > 0 && (
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Clock className="h-3.5 w-3.5 text-primary" />
            Movimentações ({parsed.eventos.length})
          </div>
          <Separator />
          <ul className="space-y-2">
            {parsed.eventos.map((e, i) => (
              <li key={i} className="flex gap-2.5">
                <div className="text-[11px] font-mono text-muted-foreground shrink-0 w-24 pt-0.5">{e.data}</div>
                <div className="text-sm flex-1">{e.descricao}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Links úteis */}
      {parsed.links && parsed.links.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            Links
          </div>
          {parsed.links.map((l, i) => (
            <a
              key={i}
              href={l}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary hover:underline break-all"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              {l}
            </a>
          ))}
        </div>
      )}

      {parsed.rodape && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Rodapé / aviso original</summary>
          <p className="mt-1 leading-relaxed">{parsed.rodape}</p>
        </details>
      )}
    </div>
  );
}
