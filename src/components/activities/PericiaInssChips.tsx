// =============================================================================
// Dois campos de data no cabeçalho da atividade: PERÍCIA MÉDICA e PERÍCIA SOCIAL.
//
// Aparecem só quando a atividade está vinculada a um processo "Benefício INSS"
// (regra em `isBeneficioInssProcess`). Fora do INSS o cabeçalho fica como estava.
//
// As datas moram no PROCESSO (`lead_processes.pericia_medica_at` /
// `pericia_social_at`), não na atividade: a perícia é uma só por benefício, e
// preenchida aqui ela aparece em todas as atividades daquele processo — inclusive
// nas que forem criadas depois. Por isso o chip salva na hora, sem depender do
// "Salvar" da atividade (que grava `lead_activities`, outra tabela).
//
// Interação: chip → popover com o campo (regra de UI — nada de redirecionar,
// nada de abrir aba; o cabeçalho continua legível com o popover fechado).
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stethoscope, HeartHandshake, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { db, ensureExternalSession } from '@/integrations/supabase';
import {
  isBeneficioInssProcess,
  periciaInputValue,
  periciaIsoFromInput,
  formatPericia,
  periciaTom,
  PERICIA_LABEL,
  type PericiaCampo,
} from '@/lib/periciaInss';

interface Props {
  processId?: string | null;
  /** Snapshot `process_title` da atividade — evita piscar antes do dado vivo chegar. */
  processTitle?: string | null;
  className?: string;
}

type Datas = Record<PericiaCampo, string | null>;

const TOM_CLASS: Record<string, string> = {
  vazio: 'bg-muted text-muted-foreground hover:bg-muted/80',
  futura: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-900/60',
  hoje: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60',
  passada: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700',
};

export default function PericiaInssChips({ processId, processTitle, className = '' }: Props) {
  const [title, setTitle] = useState<string | null>(processTitle || null);
  const [datas, setDatas] = useState<Datas>({ pericia_medica_at: null, pericia_social_at: null });
  const [carregou, setCarregou] = useState(false);

  useEffect(() => {
    if (!processId) { setCarregou(false); return; }
    let cancelled = false;
    (async () => {
      await ensureExternalSession();
      const { data, error } = await db
        .from('lead_processes')
        .select('id, title, pericia_medica_at, pericia_social_at')
        .eq('id', processId)
        .maybeSingle();
      if (cancelled) return;
      if (error) { setCarregou(false); return; }
      const row = data as unknown as { title?: string | null } & Partial<Datas> | null;
      setTitle(row?.title ?? processTitle ?? null);
      setDatas({
        pericia_medica_at: row?.pericia_medica_at ?? null,
        pericia_social_at: row?.pericia_social_at ?? null,
      });
      setCarregou(true);
    })();
    return () => { cancelled = true; };
  }, [processId, processTitle]);

  const salvar = useCallback(async (campo: PericiaCampo, iso: string | null) => {
    if (!processId) return false;
    await ensureExternalSession();
    const { error } = await db
      .from('lead_processes')
      .update({ [campo]: iso } as never)
      .eq('id', processId);
    if (error) {
      toast.error(`Não foi possível salvar a ${PERICIA_LABEL[campo].toLowerCase()}: ${error.message}`);
      return false;
    }
    setDatas(prev => ({ ...prev, [campo]: iso }));
    toast.success(iso
      ? `${PERICIA_LABEL[campo]} marcada para ${formatPericia(iso)}`
      : `${PERICIA_LABEL[campo]} removida`);
    return true;
  }, [processId]);

  // Título ainda desconhecido (ou processo não-INSS): nada a mostrar.
  if (!processId || !carregou || !isBeneficioInssProcess(title)) return null;

  return (
    <>
      <PericiaChip campo="pericia_medica_at" valor={datas.pericia_medica_at} onSalvar={salvar} className={className} />
      <PericiaChip campo="pericia_social_at" valor={datas.pericia_social_at} onSalvar={salvar} className={className} />
    </>
  );
}

function PericiaChip({
  campo, valor, onSalvar, className = '',
}: {
  campo: PericiaCampo;
  valor: string | null;
  onSalvar: (campo: PericiaCampo, iso: string | null) => Promise<boolean>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (open) setRascunho(periciaInputValue(valor)); }, [open, valor]);

  const Icon = campo === 'pericia_medica_at' ? Stethoscope : HeartHandshake;
  const label = PERICIA_LABEL[campo];
  const tom = periciaTom(valor);

  const confirmar = async (iso: string | null) => {
    setSalvando(true);
    const ok = await onSalvar(campo, iso);
    setSalvando(false);
    if (ok) setOpen(false);
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
          title={valor
            ? `${label}: ${formatPericia(valor)} — clique para alterar ou remover`
            : `${label} ainda não marcada — clique para informar a data e a hora`}
        >
          <Icon className="h-3 w-3" />
          {valor ? `${label}: ${formatPericia(valor)}` : `${label}: marcar`}
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
          Data e hora da convocação. Fica no processo — aparece em todas as atividades deste benefício.
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 text-xs flex-1"
            disabled={salvando || !rascunho}
            onClick={() => confirmar(periciaIsoFromInput(rascunho))}
          >
            {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar'}
          </Button>
          {valor && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive"
              disabled={salvando}
              onClick={() => confirmar(null)}
            >
              Remover
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
