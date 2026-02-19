import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Settings2, User } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { TimeBlockSettingsDialog } from '@/components/activities/TimeBlockSettingsDialog';
import { cn } from '@/lib/utils';

const WEEK_DAYS = [
  { label: 'SEG', idx: 0 },
  { label: 'TER', idx: 1 },
  { label: 'QUA', idx: 2 },
  { label: 'QUI', idx: 3 },
  { label: 'SEX', idx: 4 },
];

function MemberRoutineView({ userId, memberName }: { userId: string; memberName: string }) {
  const { configs, loading, saveSettings } = useTimeBlockSettings(userId);
  const [editOpen, setEditOpen] = useState(false);
  const handleSave = (newConfigs: Parameters<typeof saveSettings>[0]) => saveSettings(newConfigs, userId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{memberName}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          Editar Rotina
        </Button>
      </div>

      {/* Grade visual da rotina */}
      <div className="rounded-lg border p-4 bg-muted/10">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Grade Semanal</p>
        <div className="grid grid-cols-5 gap-2">
          {WEEK_DAYS.map(d => (
            <div key={d.idx} className="space-y-1.5">
              <div className="text-center text-xs font-bold text-muted-foreground">{d.label}</div>
              {configs.filter(c => c.days.includes(d.idx)).map(c => (
                <div
                  key={c.activityType}
                  className={cn('rounded-md px-2 py-1.5 text-white text-[10px] font-semibold', c.color)}
                >
                  <div className="truncate">{c.label}</div>
                  <div className="opacity-80">{c.startHour}h–{c.endHour}h</div>
                </div>
              ))}
              {configs.filter(c => c.days.includes(d.idx)).length === 0 && (
                <div className="rounded-md border border-dashed border-muted-foreground/20 h-10 flex items-center justify-center">
                  <span className="text-[9px] text-muted-foreground/40">vazio</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Resumo dos blocos */}
      <div className="flex flex-wrap gap-2">
        {configs.map(c => (
          <Badge key={c.activityType} variant="outline" className="gap-1.5 text-xs">
            <span className={cn('h-2 w-2 rounded-full', c.color)} />
            {c.label}
            <span className="text-muted-foreground">
              {c.days.length === 0 ? 'nenhum dia' : `${c.days.length} dia${c.days.length > 1 ? 's' : ''}`}
            </span>
          </Badge>
        ))}
      </div>

      <TimeBlockSettingsDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        configs={configs}
        onSave={handleSave}
      />
    </div>
  );
}

export function MemberRoutineManager() {
  const { members, loading } = useTeamMembers();
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedMember = members.find(m => m.user_id === selectedUserId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="h-5 w-5" />
          Rotinas de Trabalho por Membro
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Visualize e edite os blocos de tempo da rotina semanal de cada colaborador.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            Selecionar membro:
          </label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Escolha um colaborador..." />
            </SelectTrigger>
            <SelectContent>
              {members.map(m => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  <div className="flex items-center gap-2">
                    <span>{m.full_name || m.email || 'Sem nome'}</span>
                    {m.role === 'admin' && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">Admin</Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedUserId && selectedMember ? (
          <MemberRoutineView
            userId={selectedUserId}
            memberName={selectedMember.full_name || selectedMember.email || 'Colaborador'}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg bg-muted/5">
            <User className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Selecione um colaborador para ver e editar a rotina</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
