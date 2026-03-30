import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Briefcase, Plus, Trash2, Edit, Users, Loader2, GraduationCap,
  ChevronRight, Sparkles, FolderOpen, ArrowRight, DollarSign, GitBranch,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface CareerPlan {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  is_active: boolean;
  created_at: string;
}

interface JobPosition {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  level: number;
  color: string;
  is_active: boolean;
  career_plan_id: string | null;
  salary_fixed: number | null;
  salary_variable: number | null;
  ote_total: number | null;
  track_type: 'ic' | 'management';
  allows_demotion: boolean;
  demotion_note: string | null;
  created_at: string;
}

interface CareerStep {
  id: string;
  from_position_id: string | null;
  to_position_id: string;
  step_order: number;
  requirements: string | null;
  estimated_months: number | null;
}

interface MemberPosition {
  id: string;
  user_id: string;
  position_id: string;
  assigned_at: string;
  notes: string | null;
}

export function CareerPlanManager() {
  const [careerPlans, setCareerPlans] = useState<CareerPlan[]>([]);
  const [positions, setPositions] = useState<JobPosition[]>([]);
  const [careerSteps, setCareerSteps] = useState<CareerStep[]>([]);
  const [memberPositions, setMemberPositions] = useState<MemberPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<CareerPlan | null>(null);
  const { members } = useTeamMembers();

  // Career plan dialog
  const [planDialog, setPlanDialog] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CareerPlan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [planDept, setPlanDept] = useState('');

  // Position dialog
  const [posDialog, setPosDialog] = useState(false);
  const [editingPos, setEditingPos] = useState<JobPosition | null>(null);
  const [posName, setPosName] = useState('');
  const [posDesc, setPosDesc] = useState('');
  const [posLevel, setPosLevel] = useState(1);
  const [posColor, setPosColor] = useState('#6366f1');
  const [posTrack, setPosTrack] = useState<'ic' | 'management'>('ic');
  const [posSalaryFixed, setPosSalaryFixed] = useState('');
  const [posSalaryVariable, setPosSalaryVariable] = useState('');
  const [posAllowsDemotion, setPosAllowsDemotion] = useState(true);

  // Career step dialog
  const [stepDialog, setStepDialog] = useState(false);
  const [stepFrom, setStepFrom] = useState('');
  const [stepTo, setStepTo] = useState('');
  const [stepReqs, setStepReqs] = useState('');
  const [stepMonths, setStepMonths] = useState('');

  // Assign member dialog
  const [assignDialog, setAssignDialog] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignPositionId, setAssignPositionId] = useState('');

  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPromptDialog, setAiPromptDialog] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiEditDialog, setAiEditDialog] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [plansRes, posRes, stepsRes, mpRes] = await Promise.all([
      (supabase as any).from('career_plans').select('*').order('created_at', { ascending: false }),
      (supabase as any).from('job_positions').select('*').order('level', { ascending: true }).order('name'),
      (supabase as any).from('career_plan_steps').select('*').order('step_order'),
      (supabase as any).from('member_positions').select('*'),
    ]);
    setCareerPlans(plansRes.data || []);
    setPositions(posRes.data || []);
    setCareerSteps(stepsRes.data || []);
    setMemberPositions(mpRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ---- Career Plan CRUD ----
  const openNewPlan = () => {
    setEditingPlan(null);
    setPlanName(''); setPlanDesc(''); setPlanDept('');
    setPlanDialog(true);
  };

  const openEditPlan = (p: CareerPlan) => {
    setEditingPlan(p);
    setPlanName(p.name); setPlanDesc(p.description || ''); setPlanDept(p.department || '');
    setPlanDialog(true);
  };

  const savePlan = async () => {
    if (!planName.trim()) { toast.error('Informe o nome da carreira'); return; }
    setSaving(true);
    try {
      if (editingPlan) {
        await (supabase as any).from('career_plans').update({
          name: planName, description: planDesc || null, department: planDept || null,
        }).eq('id', editingPlan.id);
        toast.success('Carreira atualizada');
      } else {
        const { data } = await (supabase as any).from('career_plans').insert({
          name: planName, description: planDesc || null, department: planDept || null,
        }).select().single();
        if (data) setSelectedPlan(data);
        toast.success('Carreira criada');
      }
      setPlanDialog(false);
      fetchAll();
    } catch { toast.error('Erro ao salvar carreira'); }
    setSaving(false);
  };

  const deletePlan = async (id: string) => {
    await (supabase as any).from('career_plans').delete().eq('id', id);
    if (selectedPlan?.id === id) setSelectedPlan(null);
    toast.success('Carreira removida');
    fetchAll();
  };

  // ---- Position CRUD ----
  const planPositions = positions.filter(p => p.career_plan_id === selectedPlan?.id);

  const openNewPosition = () => {
    setEditingPos(null);
    setPosName(''); setPosDesc(''); setPosLevel(1); setPosColor('#6366f1');
    setPosTrack('ic'); setPosSalaryFixed(''); setPosSalaryVariable(''); setPosAllowsDemotion(true);
    setPosDialog(true);
  };

  const openEditPosition = (p: JobPosition) => {
    setEditingPos(p);
    setPosName(p.name); setPosDesc(p.description || '');
    setPosLevel(p.level); setPosColor(p.color);
    setPosTrack(p.track_type || 'ic');
    setPosSalaryFixed(p.salary_fixed?.toString() || '');
    setPosSalaryVariable(p.salary_variable?.toString() || '');
    setPosAllowsDemotion(p.allows_demotion ?? true);
    setPosDialog(true);
  };

  const savePosition = async () => {
    if (!posName.trim() || !selectedPlan) { toast.error('Informe o nome do cargo'); return; }
    setSaving(true);
    try {
      if (editingPos) {
        await (supabase as any).from('job_positions').update({
          name: posName, description: posDesc || null,
          level: posLevel, color: posColor, track_type: posTrack,
          salary_fixed: posSalaryFixed ? parseFloat(posSalaryFixed) : null,
          salary_variable: posSalaryVariable ? parseFloat(posSalaryVariable) : null,
          ote_total: (posSalaryFixed ? parseFloat(posSalaryFixed) : 0) + (posSalaryVariable ? parseFloat(posSalaryVariable) : 0) || null,
          allows_demotion: posAllowsDemotion,
        }).eq('id', editingPos.id);
        toast.success('Cargo atualizado');
      } else {
        await (supabase as any).from('job_positions').insert({
          name: posName, description: posDesc || null,
          department: selectedPlan.department || null,
          level: posLevel, color: posColor,
          career_plan_id: selectedPlan.id,
          track_type: posTrack,
          salary_fixed: posSalaryFixed ? parseFloat(posSalaryFixed) : null,
          salary_variable: posSalaryVariable ? parseFloat(posSalaryVariable) : null,
          ote_total: (posSalaryFixed ? parseFloat(posSalaryFixed) : 0) + (posSalaryVariable ? parseFloat(posSalaryVariable) : 0) || null,
          allows_demotion: posAllowsDemotion,
        });
        toast.success('Cargo criado');
      }
      setPosDialog(false);
      fetchAll();
    } catch { toast.error('Erro ao salvar cargo'); }
    setSaving(false);
  };

  const deletePosition = async (id: string) => {
    await (supabase as any).from('job_positions').delete().eq('id', id);
    toast.success('Cargo removido');
    fetchAll();
  };

  // ---- Steps ----
  const planSteps = careerSteps.filter(s => {
    const toPos = positions.find(p => p.id === s.to_position_id);
    return toPos?.career_plan_id === selectedPlan?.id;
  });

  const saveStep = async () => {
    if (!stepTo) { toast.error('Selecione o cargo destino'); return; }
    setSaving(true);
    try {
      await (supabase as any).from('career_plan_steps').insert({
        from_position_id: stepFrom || null,
        to_position_id: stepTo,
        requirements: stepReqs || null,
        estimated_months: stepMonths ? parseInt(stepMonths) : null,
        step_order: careerSteps.length + 1,
      });
      toast.success('Progressão adicionada');
      setStepDialog(false);
      setStepFrom(''); setStepTo(''); setStepReqs(''); setStepMonths('');
      fetchAll();
    } catch { toast.error('Erro ao salvar progressão'); }
    setSaving(false);
  };

  const deleteStep = async (id: string) => {
    await (supabase as any).from('career_plan_steps').delete().eq('id', id);
    toast.success('Progressão removida');
    fetchAll();
  };

  // ---- Member assignment ----
  const assignMember = async () => {
    if (!assignUserId || !assignPositionId) { toast.error('Selecione membro e cargo'); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('member_positions').insert({
        user_id: assignUserId, position_id: assignPositionId,
      });
      if (error?.code === '23505') { toast.error('Membro já possui este cargo'); setSaving(false); return; }
      if (error) throw error;
      toast.success('Cargo atribuído');
      setAssignDialog(false);
      setAssignUserId(''); setAssignPositionId('');
      fetchAll();
    } catch { toast.error('Erro ao atribuir cargo'); }
    setSaving(false);
  };

  const removeAssignment = async (id: string) => {
    await (supabase as any).from('member_positions').delete().eq('id', id);
    toast.success('Atribuição removida');
    fetchAll();
  };

  // ---- AI Suggestion (within existing plan) ----
  const generateAIPlan = async () => {
    if (!selectedPlan) return;
    setAiLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-career-plan', {
        body: {
          careerName: selectedPlan.name,
          department: selectedPlan.department,
          existingPositions: planPositions.map(p => p.name),
        },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); setAiLoading(false); return; }
      await insertAIPositionsAndSteps(data, selectedPlan.id, selectedPlan.department);
      toast.success('Plano de carreira gerado com IA!');
      fetchAll();
    } catch (e: any) {
      toast.error('Erro ao gerar plano: ' + (e?.message || 'erro desconhecido'));
    }
    setAiLoading(false);
  };

  // ---- AI Edit existing plan ----
  const editWithAI = async () => {
    if (!selectedPlan || !aiEditPrompt.trim()) { toast.error('Descreva as alterações desejadas'); return; }
    setAiLoading(true);
    try {
      const currentStructure = {
        positions: planPositions.map(p => ({
          name: p.name,
          description: p.description,
          level: p.level,
          color: p.color,
          track_type: p.track_type,
          salary_fixed: p.salary_fixed,
          salary_variable: p.salary_variable,
          allows_demotion: p.allows_demotion,
          demotion_note: p.demotion_note,
        })),
        steps: planSteps.map(s => ({
          from: getPositionName(s.from_position_id || ''),
          to: getPositionName(s.to_position_id),
          requirements: s.requirements,
          estimated_months: s.estimated_months,
        })),
      };

      const { data, error } = await cloudFunctions.invoke('suggest-career-plan', {
        body: {
          careerName: selectedPlan.name,
          department: selectedPlan.department,
          editMode: true,
          currentStructure,
          userPrompt: aiEditPrompt,
        },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); setAiLoading(false); return; }

      // Remove old positions and steps for this plan
      const oldPosIds = planPositions.map(p => p.id);
      if (oldPosIds.length > 0) {
        await (supabase as any).from('career_plan_steps')
          .delete()
          .or(oldPosIds.map(id => `to_position_id.eq.${id}`).join(','));
        await (supabase as any).from('job_positions')
          .delete()
          .eq('career_plan_id', selectedPlan.id);
      }

      await insertAIPositionsAndSteps(data, selectedPlan.id, selectedPlan.department);
      toast.success('Plano de carreira atualizado com IA!');
      setAiEditDialog(false);
      setAiEditPrompt('');
      fetchAll();
    } catch (e: any) {
      toast.error('Erro ao editar plano: ' + (e?.message || 'erro desconhecido'));
    }
    setAiLoading(false);
  };

  // ---- AI Full Career from Prompt ----
  const generateFullCareerFromPrompt = async () => {
    if (!aiPrompt.trim()) { toast.error('Descreva a carreira que deseja criar'); return; }
    setAiLoading(true);
    try {
      // Create the career plan first
      const { data: newPlan, error: planError } = await (supabase as any).from('career_plans').insert({
        name: aiPrompt.trim().slice(0, 60),
        description: `Gerado por IA: ${aiPrompt}`,
      }).select().single();
      if (planError) throw planError;

      // Generate positions & steps via AI
      const { data, error } = await cloudFunctions.invoke('suggest-career-plan', {
        body: {
          careerName: aiPrompt,
          department: null,
          existingPositions: [],
          userPrompt: aiPrompt,
        },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); setAiLoading(false); return; }

      await insertAIPositionsAndSteps(data, newPlan.id, null);

      toast.success('Carreira completa gerada com IA!');
      setAiPromptDialog(false);
      setAiPrompt('');
      await fetchAll();
      setSelectedPlan(newPlan);
    } catch (e: any) {
      toast.error('Erro ao gerar carreira: ' + (e?.message || 'erro desconhecido'));
    }
    setAiLoading(false);
  };

  const insertAIPositionsAndSteps = async (data: any, planId: string, department: string | null) => {
    const { positions: aiPositions, steps: aiSteps } = data;
    const positionIds: string[] = [];
    for (const pos of aiPositions) {
      const { data: inserted } = await (supabase as any).from('job_positions').insert({
        name: pos.name, description: pos.description, level: pos.level,
        color: pos.color, career_plan_id: planId,
        department: department || null,
        track_type: pos.track_type || 'ic',
        salary_fixed: pos.salary_fixed || null,
        salary_variable: pos.salary_variable || null,
        ote_total: (pos.salary_fixed || 0) + (pos.salary_variable || 0) || null,
        allows_demotion: pos.allows_demotion ?? true,
        demotion_note: pos.demotion_note || null,
      }).select('id').single();
      positionIds.push(inserted?.id);
    }
    for (const step of aiSteps) {
      const fromId = step.from_index !== null && step.from_index !== undefined ? positionIds[step.from_index] : null;
      const toId = positionIds[step.to_index];
      if (toId) {
        await (supabase as any).from('career_plan_steps').insert({
          from_position_id: fromId || null,
          to_position_id: toId,
          requirements: step.requirements,
          estimated_months: step.estimated_months,
          step_order: (step.from_index ?? -1) + 1,
        });
      }
    }
  };

  const getPositionName = (id: string) => positions.find(p => p.id === id)?.name || '—';
  const getMemberName = (userId: string) => {
    const m = members.find(m => m.user_id === userId);
    return m?.full_name || m?.email || userId;
  };

  const levelColors = ['bg-emerald-100 text-emerald-800', 'bg-blue-100 text-blue-800', 'bg-purple-100 text-purple-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800'];

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  // ============ LIST VIEW (no plan selected) ============
  if (!selectedPlan) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><GraduationCap className="h-5 w-5" /> Carreiras</CardTitle>
              <CardDescription>Crie carreiras (ex: Comercial, Jurídico) e depois defina cargos e progressões</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setAiPromptDialog(true)} variant="outline" size="sm">
                <Sparkles className="h-4 w-4 mr-1" /> Gerar com IA
              </Button>
              <Button onClick={openNewPlan} size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Carreira</Button>
            </div>
          </CardHeader>
          <CardContent>
            {careerPlans.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">Nenhuma carreira cadastrada. Crie a primeira!</p>
            ) : (
              <div className="grid gap-3">
                {careerPlans.map(plan => {
                  const posCount = positions.filter(p => p.career_plan_id === plan.id).length;
                  return (
                    <div
                      key={plan.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedPlan(plan)}
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">{plan.name}</p>
                          {plan.description && <p className="text-xs text-muted-foreground">{plan.description}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {plan.department && <Badge variant="outline">{plan.department}</Badge>}
                        <Badge variant="secondary">{posCount} cargos</Badge>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); openEditPlan(plan); }}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={e => e.stopPropagation()}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir carreira "{plan.name}"?</AlertDialogTitle>
                                <AlertDialogDescription>Todos os cargos e progressões desta carreira serão removidos.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deletePlan(plan.id)}>Excluir</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Plan Dialog */}
        <Dialog open={planDialog} onOpenChange={setPlanDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingPlan ? 'Editar Carreira' : 'Nova Carreira'}</DialogTitle>
              <DialogDescription>Defina o nome e departamento da carreira</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome da Carreira *</Label>
                <Input placeholder="Ex: Comercial, Jurídico, Marketing..." value={planName} onChange={e => setPlanName(e.target.value)} />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea placeholder="Descrição da carreira..." value={planDesc} onChange={e => setPlanDesc(e.target.value)} rows={3} />
              </div>
              <div>
                <Label>Departamento</Label>
                <Input placeholder="Ex: Vendas, Jurídico..." value={planDept} onChange={e => setPlanDept(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlanDialog(false)}>Cancelar</Button>
              <Button onClick={savePlan} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editingPlan ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* AI Prompt Dialog */}
        <Dialog open={aiPromptDialog} onOpenChange={setAiPromptDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Gerar Carreira com IA</DialogTitle>
              <DialogDescription>
                Descreva a carreira que deseja criar e a IA montará cargos, níveis e progressões baseados nas melhores práticas de empresas americanas.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Descreva a carreira *</Label>
                <Textarea
                  placeholder="Ex: Quero um plano de carreira para o time comercial de um escritório de advocacia, com SDR, Closer e Gerente..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">💡 Dicas de prompt:</p>
                <p>• Especifique a área: "time comercial", "departamento jurídico", "marketing digital"</p>
                <p>• Mencione cargos que já conhece: "incluir SDR, BDR e Closer"</p>
                <p>• Defina o tamanho: "equipe pequena de 5 pessoas" ou "departamento grande"</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAiPromptDialog(false)}>Cancelar</Button>
              <Button onClick={generateFullCareerFromPrompt} disabled={aiLoading}>
                {aiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                Gerar Carreira
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ============ DETAIL VIEW (plan selected) ============
  const planMemberPositions = memberPositions.filter(mp =>
    planPositions.some(p => p.id === mp.position_id)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setSelectedPlan(null)}>
          ← Voltar
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GraduationCap className="h-5 w-5" /> {selectedPlan.name}
          </h2>
          {selectedPlan.description && <p className="text-sm text-muted-foreground">{selectedPlan.description}</p>}
        </div>
        <div className="flex gap-2">
          {planPositions.length > 0 && (
            <Button onClick={() => setAiEditDialog(true)} variant="outline" size="sm" disabled={aiLoading}>
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Edit className="h-4 w-4 mr-1" />}
              Editar com IA
            </Button>
          )}
          <Button onClick={generateAIPlan} variant="outline" size="sm" disabled={aiLoading}>
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Gerar com IA
          </Button>
        </div>
      </div>

      {/* Cargos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5" /> Cargos</CardTitle>
            <CardDescription>Cargos desta carreira (ex: SDR, Closer, Advogado)</CardDescription>
          </div>
          <Button onClick={openNewPosition} size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Cargo</Button>
        </CardHeader>
        <CardContent>
          {planPositions.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">Nenhum cargo cadastrado. Crie ou gere com IA!</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Trilha</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>OTE (Fixo + Variável)</TableHead>
                  <TableHead>Membros</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planPositions.map(p => {
                  const count = memberPositions.filter(mp => mp.position_id === p.id).length;
                  const formatCurrency = (v: number | null) => v ? `R$ ${v.toLocaleString('pt-BR')}` : '—';
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                          <span className="font-medium">{p.name}</span>
                        </div>
                        {p.description && (
                          <details className="mt-0.5 max-w-sm group/desc">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none select-none">
                              <span className="line-clamp-1 group-open/desc:hidden">▸ {p.description}</span>
                              <span className="hidden group-open/desc:inline font-medium">▾ Ocultar descrição</span>
                            </summary>
                            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{p.description}</p>
                          </details>
                        )}
                        {p.allows_demotion && p.demotion_note && (
                          <p className="text-xs text-amber-600 mt-0.5">↩ {p.demotion_note}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.track_type === 'management' ? 'default' : 'outline'} className="text-xs">
                          {p.track_type === 'management' ? '👔 Gestão' : '⚡ IC'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={levelColors[(p.level - 1) % levelColors.length]} variant="secondary">
                          Nível {p.level}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-0.5">
                          <p>Fixo: <span className="font-medium">{formatCurrency(p.salary_fixed)}</span></p>
                          <p>Var: <span className="font-medium">{formatCurrency(p.salary_variable)}</span></p>
                          {p.ote_total && <p className="text-primary font-semibold">OTE: {formatCurrency(p.ote_total)}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline"><Users className="h-3 w-3 mr-1" />{count}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditPosition(p)}><Edit className="h-4 w-4" /></Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir cargo "{p.name}"?</AlertDialogTitle>
                                <AlertDialogDescription>As atribuições e progressões vinculadas serão removidas.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deletePosition(p.id)}>Excluir</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Membros & Cargos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Membros & Cargos</CardTitle>
            <CardDescription>Atribua membros aos cargos desta carreira</CardDescription>
          </div>
          <Button onClick={() => setAssignDialog(true)} size="sm" disabled={planPositions.length === 0}>
            <Plus className="h-4 w-4 mr-1" /> Atribuir
          </Button>
        </CardHeader>
        <CardContent>
          {planMemberPositions.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">Nenhum membro atribuído nesta carreira.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membro</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planMemberPositions.map(mp => (
                  <TableRow key={mp.id}>
                    <TableCell className="font-medium">{getMemberName(mp.user_id)}</TableCell>
                    <TableCell><Badge variant="secondary">{getPositionName(mp.position_id)}</Badge></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeAssignment(mp.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Progressão */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ArrowRight className="h-5 w-5" /> Progressão</CardTitle>
            <CardDescription>Passos de evolução entre os cargos</CardDescription>
          </div>
          <Button onClick={() => setStepDialog(true)} size="sm" disabled={planPositions.length < 2}>
            <Plus className="h-4 w-4 mr-1" /> Nova Progressão
          </Button>
        </CardHeader>
        <CardContent>
          {planSteps.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">Nenhuma progressão definida.</p>
          ) : (
            <div className="space-y-3">
              {planSteps.map(step => (
                <div key={step.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <Badge variant="outline" className="whitespace-nowrap">
                    {step.from_position_id ? getPositionName(step.from_position_id) : 'Entrada'}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <Badge className="whitespace-nowrap bg-primary/10 text-primary">
                    {getPositionName(step.to_position_id)}
                  </Badge>
                  {step.estimated_months && (
                    <span className="text-xs text-muted-foreground ml-2">~{step.estimated_months} meses</span>
                  )}
                  {step.requirements && (
                    <span className="text-xs text-muted-foreground flex-1 truncate ml-2" title={step.requirements}>
                      {step.requirements}
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={() => deleteStep(step.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Position Dialog */}
      <Dialog open={posDialog} onOpenChange={setPosDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPos ? 'Editar Cargo' : 'Novo Cargo'}</DialogTitle>
            <DialogDescription>Defina nome e nível do cargo</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome do Cargo *</Label>
              <Input placeholder="Ex: SDR, Closer, Advogado..." value={posName} onChange={e => setPosName(e.target.value)} />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea placeholder="Responsabilidades do cargo..." value={posDesc} onChange={e => setPosDesc(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Trilha</Label>
                <Select value={posTrack} onValueChange={v => setPosTrack(v as 'ic' | 'management')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ic">⚡ IC (Contribuidor Individual)</SelectItem>
                    <SelectItem value="management">👔 Gestão</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Nível (senioridade)</Label>
                <Select value={String(posLevel)} onValueChange={v => setPosLevel(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>Nível {n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> Salário Fixo (R$)</Label>
                <Input type="number" placeholder="Ex: 3000" value={posSalaryFixed} onChange={e => setPosSalaryFixed(e.target.value)} />
              </div>
              <div>
                <Label className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> Variável na Meta (R$)</Label>
                <Input type="number" placeholder="Ex: 2000" value={posSalaryVariable} onChange={e => setPosSalaryVariable(e.target.value)} />
              </div>
            </div>
            {posSalaryFixed && posSalaryVariable && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <span className="text-muted-foreground">OTE (On-Target Earnings): </span>
                <span className="font-semibold text-primary">
                  R$ {((parseFloat(posSalaryFixed) || 0) + (parseFloat(posSalaryVariable) || 0)).toLocaleString('pt-BR')}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input type="color" value={posColor} onChange={e => setPosColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
              <span className="text-sm text-muted-foreground">{posColor}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPosDialog(false)}>Cancelar</Button>
            <Button onClick={savePosition} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editingPos ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Career Step Dialog */}
      <Dialog open={stepDialog} onOpenChange={setStepDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Progressão</DialogTitle>
            <DialogDescription>Defina de qual cargo para qual cargo o membro pode progredir</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>De (cargo atual)</Label>
              <Select value={stepFrom} onValueChange={setStepFrom}>
                <SelectTrigger><SelectValue placeholder="Entrada (primeiro cargo)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entry">Entrada (primeiro cargo)</SelectItem>
                  {planPositions.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Para (próximo cargo) *</Label>
              <Select value={stepTo} onValueChange={setStepTo}>
                <SelectTrigger><SelectValue placeholder="Selecione o cargo destino" /></SelectTrigger>
                <SelectContent>
                  {planPositions.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Requisitos</Label>
              <Textarea placeholder="Ex: 3 meses batendo meta, certificação X..." value={stepReqs} onChange={e => setStepReqs(e.target.value)} rows={3} />
            </div>
            <div>
              <Label>Tempo estimado (meses)</Label>
              <Input type="number" placeholder="Ex: 6" value={stepMonths} onChange={e => setStepMonths(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepDialog(false)}>Cancelar</Button>
            <Button onClick={saveStep} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Member Dialog */}
      <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir Cargo</DialogTitle>
            <DialogDescription>Selecione o membro e o cargo a ser atribuído</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Membro</Label>
              <Select value={assignUserId} onValueChange={setAssignUserId}>
                <SelectTrigger><SelectValue placeholder="Selecione um membro" /></SelectTrigger>
                <SelectContent>
                  {members.map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.full_name || m.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cargo</Label>
              <Select value={assignPositionId} onValueChange={setAssignPositionId}>
                <SelectTrigger><SelectValue placeholder="Selecione um cargo" /></SelectTrigger>
                <SelectContent>
                  {planPositions.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(false)}>Cancelar</Button>
            <Button onClick={assignMember} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Atribuir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* AI Edit Dialog */}
      <Dialog open={aiEditDialog} onOpenChange={setAiEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Editar Plano com IA</DialogTitle>
            <DialogDescription>
              Descreva as alterações que deseja fazer no plano de carreira "{selectedPlan.name}" e a IA aplicará as mudanças.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>O que deseja alterar? *</Label>
              <Textarea
                placeholder="Ex: Adicionar um cargo de Tech Lead entre Sênior e Gerente, aumentar o salário do Diretor em 20%, remover o cargo de Estagiário..."
                value={aiEditPrompt}
                onChange={e => setAiEditPrompt(e.target.value)}
                rows={4}
              />
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">💡 Exemplos de edições:</p>
              <p>• "Adicionar um cargo de Coordenador entre Sênior e Gerente"</p>
              <p>• "Aumentar todos os salários em 15%"</p>
              <p>• "Trocar a trilha de gestão para incluir VP e C-Level"</p>
              <p>• "Remover o cargo de Estagiário e adicionar Trainee"</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200">
              ⚠️ Atenção: os cargos atuais serão substituídos pela nova versão gerada pela IA. Membros atribuídos perderão a vinculação.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiEditDialog(false)}>Cancelar</Button>
            <Button onClick={editWithAI} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Aplicar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
