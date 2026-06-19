import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  User, FileText, Briefcase, Calendar, MapPin, Activity,
  Gavel, ExternalLink, ChevronDown, Info, Copy, Check,
} from "lucide-react";

interface ParsedInssEmail {
  isInss: boolean;
  recipient?: string;
  protocolo?: string;
  servico?: string;
  dataProtocolo?: string;
  unidade?: string;
  statusAtual?: string;
  despacho?: string;
  links?: string[];
}

const statusColor = (s?: string) => {
  const v = (s || "").toLowerCase();
  if (v.includes("exig")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (v.includes("conclu")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (v.includes("inde") || v.includes("negad")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (v.includes("defer")) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (v.includes("pend") || v.includes("anali") || v.includes("andam"))
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
};

/**
 * Extrai o valor de `Label: valor` mesmo quando o texto está colapsado
 * em uma única linha (caso típico após stripping de HTML).
 * Para no próximo rótulo conhecido, em quebra de linha ou no fim do texto.
 */
function pickField(text: string, label: RegExp, stops: RegExp): string | undefined {
  const re = new RegExp(
    `${label.source}\\s*[:\\-]\\s*([\\s\\S]*?)(?=${stops.source}|\\n|$)`,
    "i",
  );
  const m = text.match(re);
  const v = m?.[1]?.trim().replace(/\s{2,}/g, " ");
  return v && v.length ? v : undefined;
}

const LABEL_STOPS =
  /Protocolo|Servi[çc]o|Data do Protocolo|Unidade respons[áa]vel|Status atual|Despacho|É\s+poss[íi]vel|Atenciosamente|Instituto Nacional/i;

export function parseInssAdminEmail(raw: string): ParsedInssEmail {
  const text = (raw || "").replace(/\r/g, "").replace(/\u00a0/g, " ");

  // Detecção mais tolerante: qualquer um dos sinais já basta.
  const isInss =
    /Instituto Nacional do Seguro Social|noreply@inss\.gov\.br|meu\.inss\.gov\.br/i.test(text)
    || /\bProtocolo\b[\s\S]{0,40}\bServi[çc]o\b/i.test(text);

  if (!isInss) return { isInss: false };

  const recipient =
    text.match(/Prezad[oa](?:\(a\))?\s*(?:Sr\(a\)|Senhor[a]?)?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^,\n]{2,80}?)\s*[,\n]/)?.[1]?.trim();

  const protocolo     = pickField(text, /Protocolo/, LABEL_STOPS);
  const servico       = pickField(text, /Servi[çc]o/, LABEL_STOPS);
  const dataProtocolo = pickField(text, /Data do Protocolo/, LABEL_STOPS);
  const unidade       = pickField(text, /Unidade respons[áa]vel/, LABEL_STOPS);
  const statusAtual   = pickField(text, /Status atual/, LABEL_STOPS);

  // Despacho pode estar inline (sem \n) ou em bloco.
  let despacho: string | undefined;
  const desMatch = text.match(
    /Despacho\s*[:\-]\s*([\s\S]*?)(?=\s*(?:É\s+poss[íi]vel acompanhar|Atenciosamente|https?:\/\/|Instituto Nacional do Seguro Social)\b|$)/i,
  );
  if (desMatch) {
    despacho = desMatch[1].trim().replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
    if (despacho.length < 3) despacho = undefined;
  }

  // Limpa pontuação final colada nos links.
  const links = Array.from(text.matchAll(/https?:\/\/[^\s<>"')]+/g))
    .map((m) => m[0].replace(/[.,;:)\]]+$/, ""));

  return { isInss: true, recipient, protocolo, servico, dataProtocolo, unidade, statusAtual, despacho, links: Array.from(new Set(links)) };
}

function Field({
  icon: Icon, label, value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="font-medium break-words">{value}</div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs gap-1"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* noop */ }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copiado" : "Copiar"}
    </Button>
  );
}

function OriginalEmailToggle({ body }: { body: string }) {
  return (
    <Collapsible>
      <div className="flex items-center justify-between">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs">
            <ChevronDown className="h-3.5 w-3.5" /> Ver e-mail original
          </Button>
        </CollapsibleTrigger>
        <CopyButton text={body} />
      </div>
      <CollapsibleContent>
        <Separator className="my-2" />
        <pre className="mt-2 text-xs whitespace-pre-wrap break-words font-sans bg-muted/40 rounded-md p-3 max-h-[40vh] overflow-y-auto">
          {body}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function InssAdminPushEmailView({ body }: { body: string }) {
  const parsed = parseInssAdminEmail(body);

  if (!parsed.isInss) {
    // Fallback: não reconhecido — ainda assim oferece "copiar" e mostra como original.
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Info className="h-3.5 w-3.5" /> Formato não reconhecido — exibindo e-mail original
          </span>
          <CopyButton text={body} />
        </div>
        <pre className="text-sm whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto font-sans bg-muted/40 rounded-md p-3">
          {body}
        </pre>
      </div>
    );
  }

  const despachoColor = (() => {
    const d = (parsed.despacho || "").toLowerCase();
    if (/negad|inde/.test(d)) return "border-red-200 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20";
    if (/defer|conce|aprovad/.test(d)) return "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20";
    if (/exig/.test(d)) return "border-orange-200 bg-orange-50/60 dark:border-orange-900/40 dark:bg-orange-950/20";
    return "border-border bg-muted/40";
  })();

  return (
    <div className="space-y-4">
      {/* Cabeçalho institucional */}
      <div className="rounded-md bg-gradient-to-r from-blue-600 to-blue-700 text-white p-3">
        <div className="text-xs uppercase tracking-wider opacity-90">Requerimento</div>
        <div className="text-sm font-semibold">INSS — Instituto Nacional do Seguro Social</div>
      </div>

      {/* Segurado + Status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {parsed.recipient && (
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Segurado:</span>
            <span className="font-semibold">{parsed.recipient}</span>
          </div>
        )}
        {parsed.statusAtual && (
          <Badge className={statusColor(parsed.statusAtual)}>
            <Activity className="h-3 w-3 mr-1" />
            {parsed.statusAtual}
          </Badge>
        )}
      </div>

      {/* Identificação do requerimento */}
      {(parsed.protocolo || parsed.servico || parsed.dataProtocolo || parsed.unidade) && (
        <div className="rounded-md border bg-card p-3 grid gap-3 sm:grid-cols-2">
          <Field icon={FileText} label="Protocolo" value={parsed.protocolo} />
          <Field icon={Briefcase} label="Serviço" value={parsed.servico} />
          <Field icon={Calendar} label="Data do Protocolo" value={parsed.dataProtocolo} />
          <Field icon={MapPin} label="Unidade responsável" value={parsed.unidade} />
        </div>
      )}

      {/* Despacho */}
      {parsed.despacho && (
        <div className={`rounded-md border p-3 ${despachoColor}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <Gavel className="h-4 w-4 text-muted-foreground" />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Despacho
            </span>
          </div>
          <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {parsed.despacho}
          </div>
        </div>
      )}

      {/* Links de acompanhamento */}
      {parsed.links && parsed.links.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Acompanhe o andamento
          </div>
          <div className="flex flex-col gap-1.5">
            {parsed.links.map((href, i) => (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {href}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* E-mail original (sempre disponível) */}
      <OriginalEmailToggle body={body} />
    </div>
  );
}
