// Diálogo "vincular protocolo do INSS a um caso".
//
// Duas telas abrem este mesmo diálogo: a aba Processos INSS (Acompanhamento
// Processual) e a lista de protocolos da Visão Geral. Antes o diálogo existia
// só na primeira, embutido nas 1.700 linhas do InssAdminProcessesTab; foi
// extraído inteiro pra cá em vez de copiado.
//
// Fluxo: ao abrir, procura sugestões pelo nº do requerimento, CPF e nome
// (ver src/lib/inssVinculoCaso.ts). Se nenhuma servir, a busca manual aceita
// caso, lead, contato, telefone ou CPF. Lead ainda sem caso aparece como
// "(criar caso)" — o caso é criado na hora do clique.

import { useEffect, useState } from "react";
import { RefreshCw, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cloudFunctions } from "@/lib/functionRouter";
import {
  buscarCasosPorTexto,
  buscarSugestoesDeCaso,
  vincularProtocoloAoCaso,
  type CaseOption,
  type ProtocoloParaVinculo,
} from "@/lib/inssVinculoCaso";

interface Props {
  /** null = fechado. */
  proc: ProtocoloParaVinculo | null;
  /** UUID de quem está vinculando (vai em linked_by). */
  userId?: string | null;
  onClose: () => void;
  /** Chamado depois de gravar, pra tela recarregar a lista. */
  onVinculado?: (info: { caseId: string; leadId: string | null; caseNumberLabel: string }) => void;
}

export default function VincularCasoDialog({ proc, userId, onClose, onVinculado }: Props) {
  const [sugestoes, setSugestoes] = useState<CaseOption[]>([]);
  const [carregandoSugestoes, setCarregandoSugestoes] = useState(false);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<CaseOption[]>([]);
  const [gravando, setGravando] = useState(false);

  // Sugestões: uma vez por protocolo aberto.
  useEffect(() => {
    if (!proc) return;
    let vivo = true;
    setSugestoes([]);
    setOpcoes([]);
    setBusca("");
    setCarregandoSugestoes(true);
    (async () => {
      try {
        const achados = await buscarSugestoesDeCaso(proc);
        if (vivo) setSugestoes(achados);
      } catch (e: any) {
        console.error("[VincularCasoDialog] sugestões:", e);
        if (vivo) setSugestoes([]);
      } finally {
        if (vivo) setCarregandoSugestoes(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [proc]);

  // Busca manual com folga de 300ms — cada tecla dispararia 6 consultas.
  useEffect(() => {
    if (!proc) return;
    const q = busca.trim();
    if (!q) {
      setOpcoes([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const achados = await buscarCasosPorTexto(q);
        if (vivo) setOpcoes(achados);
      } catch (e: any) {
        console.error("[VincularCasoDialog] busca:", e);
        if (vivo) setOpcoes([]);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [proc, busca]);

  const vincular = async (caseOpt: CaseOption) => {
    if (!proc) return;
    setGravando(true);
    try {
      const r = await vincularProtocoloAoCaso({ proc, caseOpt, userId });
      if (r.avisoLeadProcess) {
        toast.warning("Vinculado, mas não consegui popular o processo no caso: " + r.avisoLeadProcess);
      }
      toast.success("Protocolo vinculado ao caso " + r.caseNumberLabel);
      // Avisa a equipe do caso; falha aqui não desfaz o vínculo.
      void cloudFunctions.invoke("notify-inss-update", { body: { process_id: proc.id } }).catch(() => {});
      onVinculado?.({ caseId: r.caseId, leadId: r.leadId, caseNumberLabel: r.caseNumberLabel });
      onClose();
    } catch (e: any) {
      toast.error("Erro ao vincular: " + (e?.message || "falha desconhecida"));
    } finally {
      setGravando(false);
    }
  };

  const Opcao = ({ c, destaque }: { c: CaseOption; destaque: "sugestao" | "busca" }) => (
    <button
      type="button"
      className={
        destaque === "sugestao"
          ? "w-full text-left p-2 rounded-md hover:bg-muted text-sm border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10"
          : `w-full text-left p-2 rounded hover:bg-muted text-sm border ${
              c.needs_case_creation ? "border-blue-300 bg-blue-50/40 dark:bg-blue-950/10" : ""
            }`
      }
      disabled={gravando}
      onClick={() => vincular(c)}
    >
      <div className="font-medium flex items-center gap-2">
        {c.case_number}
        {c.lead_name && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <User className="h-3 w-3" /> {c.lead_name}
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{c.title}</div>
      {c.matched_via && (
        <div
          className={`text-[11px] mt-0.5 ${
            destaque === "sugestao"
              ? "text-amber-700 dark:text-amber-400"
              : c.needs_case_creation
                ? "text-blue-700 dark:text-blue-400"
                : "text-muted-foreground"
          }`}
        >
          ↳ {c.matched_via}
        </div>
      )}
    </button>
  );

  return (
    <Dialog open={!!proc} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular {proc?.requerimento_number} a um caso</DialogTitle>
          {proc?.nome_segurado && (
            <p className="text-sm text-muted-foreground">
              Segurado: <span className="font-medium">{proc.nome_segurado}</span>
              {proc.cpf_segurado && <> · CPF {proc.cpf_segurado}</>}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Sugestões automáticas
              {carregandoSugestoes && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {carregandoSugestoes ? (
              <div className="text-xs text-muted-foreground py-2">Procurando matches…</div>
            ) : sugestoes.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">
                Nenhum lead/contato encontrado com esse nome ou CPF. Use a busca manual abaixo.
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sugestoes.map((c) => (
                  <Opcao key={c.id} c={c} destaque="sugestao" />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium mb-2">Busca manual</div>
            <Input
              placeholder="Caso, lead, contato, telefone ou CPF..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
              {opcoes.map((c) => (
                <Opcao key={c.id} c={c} destaque="busca" />
              ))}
              {busca && opcoes.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-2">
                  Nenhum caso, lead ou contato encontrado.
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={gravando}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
