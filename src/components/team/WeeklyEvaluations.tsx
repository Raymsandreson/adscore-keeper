import { useState, useMemo } from 'react';
import { useWeeklyEvaluations, EvaluationFormData } from '@/hooks/useWeeklyEvaluations';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useAuthContext } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Star, Plus, User, Users, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const CRITERIA = [
  { key: 'punctuality_score', label: 'Pontualidade', desc: 'Cumprimento de prazos e horários' },
  { key: 'communication_score', label: 'Comunicação', desc: 'Clareza e frequência de comunicação' },
  { key: 'proactivity_score', label: 'Proatividade', desc: 'Iniciativa e antecipação de problemas' },
  { key: 'quality_score', label: 'Qualidade', desc: 'Qualidade das entregas e atenção aos detalhes' },
  { key: 'teamwork_score', label: 'Trabalho em Equipe', desc: 'Colaboração e suporte aos colegas' },
] as const;

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="transition-colors"
        >
          <Star
            className={`h-6 w-6 ${star <= value ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`}
          />
        </button>
      ))}
    </div>
  );
}

function ScoreDisplay({ score }: { score: number | null }) {
  if (!score) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`h-3.5 w-3.5 ${s <= score ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/20'}`} />
      ))}
    </div>
  );
}

function EvaluationForm({
  targetUserId,
  targetName,
  isSelf,
  weekStart,
  weekEnd,
  existingEval,
  onSubmit,
  onClose,
}: {
  targetUserId: string;
  targetName: string;
  isSelf: boolean;
  weekStart: string;
  weekEnd: string;
  existingEval?: any;
  onSubmit: (data: EvaluationFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>({
    punctuality_score: existingEval?.punctuality_score || 0,
    communication_score: existingEval?.communication_score || 0,
    proactivity_score: existingEval?.proactivity_score || 0,
    quality_score: existingEval?.quality_score || 0,
    teamwork_score: existingEval?.teamwork_score || 0,
  });
  const [strengths, setStrengths] = useState(existingEval?.strengths || '');
  const [improvements, setImprovements] = useState(existingEval?.improvements || '');
  const [comments, setComments] = useState(existingEval?.comments || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const allFilled = Object.values(scores).every(s => s > 0);
    if (!allFilled) {
      toast.error('Preencha todas as notas antes de enviar');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        evaluated_id: targetUserId,
        is_self_evaluation: isSelf,
        week_start: weekStart,
        week_end: weekEnd,
        punctuality_score: scores.punctuality_score,
        communication_score: scores.communication_score,
        proactivity_score: scores.proactivity_score,
        quality_score: scores.quality_score,
        teamwork_score: scores.teamwork_score,
        strengths,
        improvements,
        comments,
      });
      toast.success(isSelf ? 'Autoavaliação salva!' : `Avaliação de ${targetName} salva!`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar avaliação');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant={isSelf ? 'default' : 'secondary'}>
          {isSelf ? 'Autoavaliação' : 'Avaliação de Colega'}
        </Badge>
        <span className="text-sm font-medium">{targetName}</span>
      </div>

      <div className="space-y-3">
        {CRITERIA.map(c => (
          <div key={c.key} className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.desc}</p>
            </div>
            <StarRating
              value={scores[c.key]}
              onChange={v => setScores(prev => ({ ...prev, [c.key]: v }))}
            />
          </div>
        ))}
      </div>

      <div className="space-y-3 pt-2">
        <div>
          <Label className="text-sm">Pontos fortes</Label>
          <Textarea
            value={strengths}
            onChange={e => setStrengths(e.target.value)}
            placeholder="O que foi destaque nesta semana..."
            className="mt-1"
            rows={2}
          />
        </div>
        <div>
          <Label className="text-sm">Pontos a melhorar</Label>
          <Textarea
            value={improvements}
            onChange={e => setImprovements(e.target.value)}
            placeholder="O que pode ser aprimorado..."
            className="mt-1"
            rows={2}
          />
        </div>
        <div>
          <Label className="text-sm">Comentários gerais</Label>
          <Textarea
            value={comments}
            onChange={e => setComments(e.target.value)}
            placeholder="Observações adicionais..."
            className="mt-1"
            rows={2}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {existingEval ? 'Atualizar' : 'Enviar'} Avaliação
        </Button>
      </div>
    </div>
  );
}

export function WeeklyEvaluations() {
  const { user } = useAuthContext();
  const { evaluations, loading, submitEvaluation, fetchEvaluations } = useWeeklyEvaluations();
  const { members } = useTeamMembers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [evalTab, setEvalTab] = useState('received');

  const weekDate = useMemo(() => {
    const base = new Date();
    const adjusted = weekOffset === 0 ? base : addWeeks(base, weekOffset);
    return {
      start: format(startOfWeek(adjusted, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      end: format(endOfWeek(adjusted, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      label: `${format(startOfWeek(adjusted, { weekStartsOn: 1 }), "dd 'de' MMM", { locale: ptBR })} - ${format(endOfWeek(adjusted, { weekStartsOn: 1 }), "dd 'de' MMM", { locale: ptBR })}`,
    };
  }, [weekOffset]);

  // Fetch when week changes
  const handleWeekChange = (offset: number) => {
    setWeekOffset(offset);
    const adjusted = addWeeks(new Date(), offset);
    const ws = format(startOfWeek(adjusted, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    fetchEvaluations(ws);
  };

  const myEvaluations = useMemo(() => 
    evaluations.filter(e => e.evaluator_id === user?.id), [evaluations, user]);
  
  const receivedEvaluations = useMemo(() => 
    evaluations.filter(e => e.evaluated_id === user?.id), [evaluations, user]);

  const selfEval = useMemo(() =>
    myEvaluations.find(e => e.is_self_evaluation && e.week_start === weekDate.start),
    [myEvaluations, weekDate.start]);

  const memberMap = useMemo(() => {
    const map: Record<string, string> = {};
    members.forEach(m => { map[m.user_id] = m.full_name || m.email || 'Usuário'; });
    return map;
  }, [members]);

  const otherMembers = useMemo(() =>
    members.filter(m => m.user_id !== user?.id), [members, user]);

  const existingEvalForSelected = useMemo(() =>
    myEvaluations.find(e => e.evaluated_id === selectedMember && e.week_start === weekDate.start),
    [myEvaluations, selectedMember, weekDate.start]);

  // Average scores received
  const avgReceived = useMemo(() => {
    if (receivedEvaluations.length === 0) return null;
    const sum = receivedEvaluations.reduce((acc, e) => acc + (e.overall_score || 0), 0);
    return (sum / receivedEvaluations.length).toFixed(1);
  }, [receivedEvaluations]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleWeekChange(weekOffset - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[180px] text-center">{weekDate.label}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleWeekChange(weekOffset + 1)}
            disabled={weekOffset >= 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Nova Avaliação
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nova Avaliação - {weekDate.label}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Quem você quer avaliar?</Label>
                <Select value={selectedMember} onValueChange={setSelectedMember}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Selecione um membro" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={user?.id || ''}>
                      <span className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5" /> Eu mesmo (Autoavaliação)
                      </span>
                    </SelectItem>
                    {otherMembers.map(m => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name || m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedMember && (
                <EvaluationForm
                  targetUserId={selectedMember}
                  targetName={selectedMember === user?.id ? 'Eu mesmo' : (memberMap[selectedMember] || 'Membro')}
                  isSelf={selectedMember === user?.id}
                  weekStart={weekDate.start}
                  weekEnd={weekDate.end}
                  existingEval={existingEvalForSelected}
                  onSubmit={submitEvaluation}
                  onClose={() => { setDialogOpen(false); setSelectedMember(''); }}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Minha Autoavaliação</p>
            {selfEval ? (
              <p className="text-2xl font-bold">{Number(selfEval.overall_score).toFixed(1)}<span className="text-sm text-muted-foreground">/5</span></p>
            ) : (
              <p className="text-sm text-muted-foreground">Não preenchida</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Média Recebida</p>
            {avgReceived ? (
              <p className="text-2xl font-bold">{avgReceived}<span className="text-sm text-muted-foreground">/5</span></p>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma avaliação</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Avaliações Realizadas</p>
            <p className="text-2xl font-bold">{myEvaluations.filter(e => e.week_start === weekDate.start).length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={evalTab} onValueChange={setEvalTab}>
        <TabsList>
          <TabsTrigger value="received" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Recebidas ({receivedEvaluations.length})
          </TabsTrigger>
          <TabsTrigger value="given" className="gap-1.5">
            <User className="h-3.5 w-3.5" />
            Realizadas ({myEvaluations.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="space-y-3 mt-4">
          {receivedEvaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma avaliação recebida nesta semana
            </p>
          ) : (
            receivedEvaluations.map(ev => (
              <Card key={ev.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      {ev.is_self_evaluation ? 'Autoavaliação' : `Avaliado por ${memberMap[ev.evaluator_id] || 'Membro'}`}
                    </CardTitle>
                    <Badge variant="outline">{Number(ev.overall_score).toFixed(1)}/5</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {CRITERIA.map(c => (
                      <div key={c.key} className="text-center">
                        <p className="text-[10px] text-muted-foreground">{c.label}</p>
                        <ScoreDisplay score={(ev as any)[c.key]} />
                      </div>
                    ))}
                  </div>
                  {ev.strengths && (
                    <p className="text-xs"><span className="font-medium text-green-600">Pontos fortes:</span> {ev.strengths}</p>
                  )}
                  {ev.improvements && (
                    <p className="text-xs"><span className="font-medium text-amber-600">A melhorar:</span> {ev.improvements}</p>
                  )}
                  {ev.comments && (
                    <p className="text-xs"><span className="font-medium">Comentários:</span> {ev.comments}</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="given" className="space-y-3 mt-4">
          {myEvaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma avaliação realizada nesta semana
            </p>
          ) : (
            myEvaluations.map(ev => (
              <Card key={ev.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      {ev.is_self_evaluation ? 'Autoavaliação' : memberMap[ev.evaluated_id] || 'Membro'}
                    </CardTitle>
                    <Badge variant="outline">{Number(ev.overall_score).toFixed(1)}/5</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {CRITERIA.map(c => (
                      <div key={c.key} className="text-center">
                        <p className="text-[10px] text-muted-foreground">{c.label}</p>
                        <ScoreDisplay score={(ev as any)[c.key]} />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
