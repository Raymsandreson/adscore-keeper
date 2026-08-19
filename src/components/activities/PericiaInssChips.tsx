// =============================================================================
// Dois campos de data no cabeçalho da atividade: PERÍCIA MÉDICA e AVALIAÇÃO
// SOCIAL. Marcar aqui cria o evento no calendário (/hearings, aba Perícias) e
// na aba Eventos — é o mesmo lugar onde a audiência já vive.
//
// QUANDO APARECE (19/08/2026 — antes era só a primeira regra):
//   1. atividade ligada a processo "Benefício INSS", ou
//   2. atividade que fala de perícia no título/tipo (`ehAtividadeDePericia`).
// A regra 2 existe porque 115 das 326 atividades vivas de perícia não têm
// processo vinculado: sem ela, um terço do serviço não tinha onde marcar data.
//
// ONDE GRAVA: `hearings`, ancorada em processo → caso → lead
// (`usePericiaDaAtividade`). Antes gravava em `lead_processes.pericia_*_at`,
// que ficou com 1 linha em dois meses. O chip salva na hora, sem depender do
// "Salvar" da atividade (que grava `lead_activities`, outra tabela).
//
// Interação: chip → popover com o campo (regra de UI — nada de redirecionar,
// nada de abrir aba; o cabeçalho continua legível com o popover fechado).
// =============================================================================
import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stethoscope, HeartHandshake, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { usePericiaDaAtividade, type PericiaMarcada } from '@/hooks/usePericiaDaAtividade';
import {
  isBeneficioInssProcess,
  ehAtividadeDePericia,
  periciaInputValue,
  periciaPartesDoInput,
  formatPericia,
  periciaTom,
  PERICIA_LABEL,
  PERICIA_TIPOS,
  type PericiaTipo,
} from '@/lib/periciaInss';

interface Props {
  processId?: string | null;
  /** Snapshot `process_title` da atividade — evita piscar antes do dado vivo chegar. */
  processTitle?: string | null;
  /** Âncoras alternativas quando a atividade não tem processo. */
  caseId?: string | null;
  leadId?: string | null;
  processNumber?: string | null;
  /** Rastro de onde a data foi marcada. */
  activityId?: string | null;
  assignedTo?: string | null;
  /** Título e tipo da atividade — decidem se o chip aparece sem processo INSS. */
  activityTitle?: string | null;
  activityTypeLabel?: string | null;
  className?: string;
}

const TOM_CLASS: Record<string, string> = {
  vazio: 'bg-muted text-muted-foreground hover:bg-muted/80',
  futura: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-900/60',
  hoje: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60',
  passada: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700',
};

export default function PericiaInssChips({
  processId, processTitle, caseId, leadId, processNumber,
  activityId, assignedTo, activityTitle, activityTypeLabel, className = '',
}: Props) {
  const [title, setTitle] = useState<string | null>(processTitle || null);
  const { pericias, carregou, temAncora, salvar, remover } = usePericiaDaAtividade({
    processId, caseId, leadId, processNumber, activityId, assignedTo,
  });

  // Título vivo do processo: o snapshot da atividade pode estar velho, e é ele
  // que decide a regra 1 ([[activity-process-label-snapshot]]).
  useEffect(() => {
    if (!processId) return;
    let cancelled = false;
    (async () => {
      await ensureExternalSession();
      const { data } = await db
        .from('lead_processes')
        .select('title')
        .eq('id', processId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as unknown as { title?: string | null } | null;
      if (row?.title) setTitle(row.title);
    })();
    return () => { cancelled = true; };
  }, [processId]);

  const mostrar = isBeneficioInssProcess(title || processTitle)
    || ehAtividadeDePericia(activityTitle, activityTypeLabel);

  // Sem âncora não há onde gravar — mostrar um chip que não salva é pior que
  // não mostrar chip nenhum.
  if (!mostrar || !temAncora || !carregou) return null;

  return (
    <>
      {PERICIA_TIPOS.map(tipo => (
        <PericiaChip
          key={tipo}
          tipo={tipo}
          marcada={pericias[tipo]}
          onSalvar={salvar}
          onRemover={remover}
          className={className}
        />
      ))}
    </>
  );
}

function PericiaChip({
  tipo, marcada, onSalvar, onRemover, className = '',
}: {
  tipo: PericiaTipo;
  marcada?: PericiaMarcada;
  onSalvar: (tipo: PericiaTipo, data: string, hora: string) => Promise<string | null>;
  onRemover: (tipo: PericiaTipo) => Promise<string | null>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (open) setRascunho(periciaInputValue(marcada?.data, marcada?.hora));
  }, [open, marcada?.data, marcada?.hora]);

  const Icon = tipo === 'medica' ? Stethoscope : HeartHandshake;
  const label = PERICIA_LABEL[tipo];
  const tom = periciaTom(marcada?.data);
  const texto = marcada ? formatPericia(marcada.data, marcada.hora) : '';

  const confirmar = async () => {
    const partes = periciaPartesDoInput(rascunho);
    if (!partes) { toast.error('Informe data e hora da convocação.'); return; }
    setSalvando(true);
    const erro = await onSalvar(tipo, partes.data, partes.hora);
    setSalvando(false);
    if (erro) { toast.error(`Não foi possível salvar a ${label.toLowerCase()}: ${erro}`); return; }
    toast.success(`${label} marcada para ${formatPericia(partes.data, partes.hora)} — já está no calendário`);
    setOpen(false);
  };

  const desmarcar = async () => {
    setSalvando(true);
    const erro = await onRemover(tipo);
    setSalvando(false);
    if (erro) { toast.error(`Não foi possível remover a ${label.toLowerCase()}: ${erro}`); return; }
    toast.success(`${label} removida do calendário`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none transition-colors',
            TOM_CLASS[tom],
            className,
          )}
          title={marcada
            ? `${label}: ${texto} — clique para remarcar ou remover`
            : `${label} ainda não marcada — clique para informar a data e a hora`}
        >
          <Icon className="h-3 w-3" />
          {marcada ? `${label}: ${texto}` : `${label}: marcar`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2 space-y-2">
        <div className="text-xs font-medium">{label}</div>
        <Input
          type="datetime-local"
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          className="h-8 text-xs"
          autoFocus
        />
        <p className="text-[10px] text-muted-foreground leading-snug">
          Data e hora da convocação. Entra no calendário de perícias e aparece em todas as
          atividades deste benefício.
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 text-xs flex-1"
            disabled={salvando || !rascunho}
            onClick={confirmar}
          >
            {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : marcada ? 'Remarcar' : 'Salvar'}
          </Button>
          {marcada && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive"
              disabled={salvando}
              onClick={desmarcar}
            >
              Remover
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
