/**
 * Aba "Visitas" dentro do lead: as visitas agendadas com assistentes sociais
 * para aquele lead, criadas/editadas com o mesmo formulário do painel /visitas.
 *
 * A lista mantém as visitas antigas à mostra — remarcação e visita já realizada
 * são o histórico que a operação consulta antes de agendar de novo.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSocialVisits, type SocialVisit } from '@/hooks/useSocialVisits';
import { SocialVisitCard } from '@/components/visitas/SocialVisitCard';
import { SocialVisitFormDialog } from '@/components/visitas/SocialVisitFormDialog';

interface Props {
  leadId: string;
  leadName: string | null;
  visitAddress?: string | null;
  visitCity?: string | null;
  visitState?: string | null;
}

export function LeadVisitsTab({ leadId, leadName, visitAddress, visitCity, visitState }: Props) {
  const { data: visits = [], isLoading } = useSocialVisits({ leadId });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SocialVisit | null>(null);

  const lockedLead = useMemo(
    () => ({
      id: leadId,
      name: leadName,
      address: visitAddress ?? null,
      city: visitCity ?? null,
      state: visitState ?? null,
    }),
    [leadId, leadName, visitAddress, visitCity, visitState],
  );

  // Mais recente primeiro: a próxima visita (ou a última feita) é o que se procura aqui.
  const ordered = useMemo(
    () => [...visits].sort((a, b) => b.visit_date.localeCompare(a.visit_date)),
    [visits],
  );

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Visitas com assistente social</h3>
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Carregando...' : `${ordered.length} visita(s) agendada(s) para este lead`}
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <CalendarPlus className="h-4 w-4" /> Agendar visita
        </Button>
      </div>

      {!isLoading && ordered.length === 0 ? (
        <div className="border rounded-lg py-10 text-center text-sm text-muted-foreground">
          Nenhuma visita agendada.
          <div className="mt-2">
            <Button variant="outline" size="sm" onClick={openCreate}>Agendar a primeira</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {ordered.map((visit) => (
            <SocialVisitCard
              key={visit.id}
              visit={visit}
              showDate
              onSelect={() => {
                setEditing(visit);
                setFormOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <SocialVisitFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        visit={editing}
        lockedLead={lockedLead}
      />
    </div>
  );
}
