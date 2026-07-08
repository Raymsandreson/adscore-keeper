import { useRef, useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import html2canvas from 'html2canvas';
import { LeadActivity } from '@/hooks/useLeadActivities';

interface TeamMember {
  user_id: string;
  full_name: string | null;
}

interface ActivityType {
  value: string;
  label: string;
  bg?: string;
  border?: string;
  header?: string;
  dot?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activities: LeadActivity[];
  teamMembers: TeamMember[];
  filterAssignee: string[];
  selectedCalDays: string[];
  allKnownActivityTypes: ActivityType[];
}

interface AssessorRow {
  name: string;
  totalOpen: number;
  totalDone: number;
  types: { label: string; open: number; done: number }[];
}

export function AssessorSummaryShareDialog({
  open,
  onOpenChange,
  activities,
  teamMembers,
  filterAssignee,
  selectedCalDays,
  allKnownActivityTypes,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const periodLabel = useMemo(() => {
    if (selectedCalDays.length === 0) return 'Geral';
    const sorted = [...selectedCalDays].sort();
    if (sorted.length === 1) {
      return format(parseISO(sorted[0]), "dd 'de' MMMM", { locale: ptBR });
    }
    const start = format(parseISO(sorted[0]), "dd/MM", { locale: ptBR });
    const end = format(parseISO(sorted[sorted.length - 1]), "dd/MM", { locale: ptBR });
    return `${start} a ${end}`;
  }, [selectedCalDays]);

  const rows: AssessorRow[] = useMemo(() => {
    const selectedMembers = filterAssignee.length > 0
      ? teamMembers.filter(m => filterAssignee.includes(m.user_id))
      : teamMembers.filter(m => activities.some(a => a.assigned_to === m.user_id));

    return selectedMembers
      .map(member => {
        const memberActivities = activities.filter(a => a.assigned_to === member.user_id);
        if (memberActivities.length === 0) return null;

        const types = allKnownActivityTypes
          .map(t => {
            const typeActs = memberActivities.filter(a => a.activity_type === t.value);
            const open = typeActs.filter(a => a.status !== 'concluida').length;
            const done = typeActs.filter(a => a.status === 'concluida').length;
            return { label: t.label, open, done };
          })
          .filter(r => r.open > 0 || r.done > 0)
          .sort((a, b) => (b.open + b.done) - (a.open + a.done));

        if (types.length === 0) return null;

        const totalOpen = types.reduce((s, r) => s + r.open, 0);
        const totalDone = types.reduce((s, r) => s + r.done, 0);

        return {
          name: member.full_name?.split(' ').slice(0, 2).join(' ') || 'Sem nome',
          totalOpen,
          totalDone,
          types,
        };
      })
      .filter((r): r is AssessorRow => r !== null)
      .sort((a, b) => (b.totalOpen + b.totalDone) - (a.totalOpen + a.totalDone));
  }, [activities, teamMembers, filterAssignee, allKnownActivityTypes]);

  const totals = useMemo(() => ({
    open: rows.reduce((s, r) => s + r.totalOpen, 0),
    done: rows.reduce((s, r) => s + r.totalDone, 0),
  }), [rows]);

  const generateImage = async () => {
    if (!cardRef.current) return null;
    setGenerating(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        backgroundColor: null,
        useCORS: true,
        logging: false,
      });
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao gerar imagem');
      return null;
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const url = await generateImage();
      if (!cancelled) setPreviewUrl(url);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, periodLabel]);

  const handleDownload = async () => {
    const url = previewUrl || await generateImage();
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `resumo-atividades-${format(new Date(), 'yyyy-MM-dd')}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success('Imagem baixada!');
  };

  const handleShare = async () => {
    const url = previewUrl || await generateImage();
    if (!url) return;

    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], `resumo-atividades-${format(new Date(), 'yyyy-MM-dd')}.png`, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Resumo por assessor',
          text: `Resumo de atividades - ${periodLabel}`,
          files: [file],
        });
        toast.success('Compartilhamento aberto');
        return;
      } catch (e) {
        // fallback para copiar/colar
      }
    }

    // Fallback: copiar para clipboard ou baixar
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      toast.success('Imagem copiada para a área de transferência');
    } catch {
      await handleDownload();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Compartilhar resumo
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          <div className="relative rounded-xl overflow-hidden border shadow-sm bg-muted/30">
            {generating && !previewUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {previewUrl ? (
              <img src={previewUrl} alt="Resumo por assessor" className="w-full h-auto" />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                Gerando preview...
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleDownload} disabled={generating}>
              <Download className="h-4 w-4 mr-2" />
              Baixar
            </Button>
            <Button className="flex-1" onClick={handleShare} disabled={generating}>
              <Share2 className="h-4 w-4 mr-2" />
              Compartilhar
            </Button>
          </div>
        </div>

        {/* Hidden card used for image generation */}
        <div className="sr-only">
          <div
            ref={cardRef}
            style={{
              width: 720,
              padding: 40,
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              color: '#f8fafc',
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}
          >
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>
                Resumo por assessor
              </div>
              <div style={{ fontSize: 15, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{periodLabel}</span>
                <span style={{ color: '#475569' }}>·</span>
                <span>{format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
              <div style={{ flex: 1, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 14, padding: '18px 20px' }}>
                <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 4 }}>Abertas</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#f87171' }}>{totals.open}</div>
              </div>
              <div style={{ flex: 1, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 14, padding: '18px 20px' }}>
                <div style={{ fontSize: 13, color: '#86efac', marginBottom: 4 }}>Concluídas</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#4ade80' }}>{totals.done}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {rows.map(row => (
                <div
                  key={row.name}
                  style={{
                    background: 'rgba(248,250,252,0.04)',
                    border: '1px solid rgba(148,163,184,0.12)',
                    borderRadius: 16,
                    padding: '18px 20px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{row.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700 }}>
                      <span style={{ color: '#f87171' }}>{row.totalOpen}</span>
                      <span style={{ color: '#475569' }}>/</span>
                      <span style={{ color: '#4ade80' }}>{row.totalDone}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {row.types.map(t => (
                      <div
                        key={t.label}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 40px 40px',
                          alignItems: 'center',
                          gap: 12,
                          fontSize: 14,
                          color: '#cbd5e1',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                        <span style={{ textAlign: 'right', fontWeight: 700, color: t.open > 0 ? '#f87171' : '#64748b' }}>
                          {t.open || '—'}
                        </span>
                        <span style={{ textAlign: 'right', fontWeight: 700, color: t.done > 0 ? '#4ade80' : '#64748b' }}>
                          {t.done || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                AdScore Keeper
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {rows.length} assessor{rows.length !== 1 ? 'es' : ''}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
