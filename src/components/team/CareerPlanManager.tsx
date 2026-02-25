import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Briefcase,
  Plus,
  Trash2,
  Edit,
  ArrowRight,
  TrendingUp,
  Users,
  Loader2,
  GraduationCap,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTeamMembers } from '@/hooks/useTeamMembers';

interface JobPosition {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  level: number;
  color: string;
  is_active: boolean;
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
  const [positions, setPositions] = useState<JobPosition[]>([]);
  const [careerSteps, setCareerSteps] = useState<CareerStep[]>([]);
  const [memberPositions, setMemberPositions] = useState<MemberPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const { members } = useTeamMembers();

  // Position dialog
  const [posDialog, setPosDialog] = useState(false);
  const [editingPos, setEditingPos] = useState<JobPosition | null>(null);
  const [posName, setPosName] = useState('');
  const [posDesc, setPosDesc] = useState('');
  const [posDept, setPosDept] = useState('');
  const [posLevel, setPosLevel] = useState(1);
  const [posColor, setPosColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);

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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [posRes, stepsRes, mpRes] = await Promise.all([
      (supabase as any).from('job_positions').select('*').order('level', { ascending: true }).order('name'),
      (supabase as any).from('career_plan_steps').select('*').order('step_order'),
      (supabase as any).from('member_positions').select('*'),
    ]);
    setPositions(posRes.data || []);
    setCareerSteps(stepsRes.data || []);
    setMemberPositions(mpRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openNewPosition = () => {
    setEditingPos(null);
    setPosName(''); setPosDesc(''); setPosDept(''); setPosLevel(1); setPosColor('#6366f1');
    setPosDialog(true);
  };

  const openEditPosition = (p: JobPosition) => {
    setEditingPos(p);
    setPosName(p.name); setPosDesc(p.description || ''); setPosDept(p.department || '');
    setPosLevel(p.level); setPosColor(p.color);
    setPosDialog(true);
  };

  const savePosition = async () => {
    if (!posName.trim()) { toast.error('Informe o nome do cargo'); return; }
    setSaving(true);
    try {
      if (editingPos) {
        await (supabase as any).from('job_positions').update({
          name: posName, description: posDesc || null, department: posDept || null,
          level: posLevel, color: posColor,
        }).eq('id', editingPos.id);
        toast.success('Cargo atualizado');
      } else {
        await (supabase as any).from('job_positions').insert({
          name: posName, description: posDesc || null, department: posDept || null,
          level: posLevel, color: posColor,
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

  const getPositionName = (id: string) => positions.find(p => p.id === id)?.name || '—';
  const getMemberName = (userId: string) => {
    const m = members.find(m => m.user_id === userId);
    return m?.full_name || m?.email || userId;
  };

  const levelColors = ['bg-emerald-100 text-emerald-800', 'bg-blue-100 text-blue-800', 'bg-purple-100 text-purple-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800'];

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {/* Cargos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5" /> Cargos</CardTitle>
            <CardDescription>Cadastre os cargos da equipe (ex: SDR, Closer, Advogado)</CardDescription>
          </div>
          <Button onClick={openNewPosition} size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Cargo</Button>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">Nenhum cargo cadastrado. Crie o primeiro!</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Membros</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map(p => {
                  const count = memberPositions.filter(mp => mp.position_id === p.id).length;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                          <span className="font-medium">{p.name}</span>
                        </div>
                        {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.department || '—'}</TableCell>
                      <TableCell>
                        <Badge className={levelColors[(p.level - 1) % levelColors.length]} variant="secondary">
                          Nível {p.level}
                        </Badge>
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

      {/* Atribuição de membros */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Membros & Cargos</CardTitle>
            <CardDescription>Atribua cargos aos membros da equipe</CardDescription>
          </div>
          <Button onClick={() => setAssignDialog(true)} size="sm" disabled={positions.length === 0}>
            <Plus className="h-4 w-4 mr-1" /> Atribuir
          </Button>
        </CardHeader>
        <CardContent>
          {memberPositions.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">Nenhum membro com cargo atribuído.</p>
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
                {memberPositions.map(mp => (
                  <TableRow key={mp.id}>
                    <TableCell className="font-medium">{getMemberName(mp.user_id)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getPositionName(mp.position_id)}</Badge>
                    </TableCell>
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

      {/* Plano de Carreira */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><GraduationCap className="h-5 w-5" /> Plano de Carreira</CardTitle>
            <CardDescription>Defina as progressões entre cargos e requisitos</CardDescription>
          </div>
          <Button onClick={() => setStepDialog(true)} size="sm" disabled={positions.length < 2}>
            <Plus className="h-4 w-4 mr-1" /> Nova Progressão
          </Button>
        </CardHeader>
        <CardContent>
          {careerSteps.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">Nenhuma progressão definida. Crie pelo menos 2 cargos primeiro.</p>
          ) : (
            <div className="space-y-3">
              {careerSteps.map(step => (
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
            <DialogDescription>Defina nome, departamento e nível do cargo</DialogDescription>
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
                <Label>Departamento</Label>
                <Input placeholder="Ex: Comercial, Jurídico..." value={posDept} onChange={e => setPosDept(e.target.value)} />
              </div>
              <div>
                <Label>Nível (senioridade)</Label>
                <Select value={String(posLevel)} onValueChange={v => setPosLevel(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5].map(n => (
                      <SelectItem key={n} value={String(n)}>Nível {n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Cor</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={posColor} onChange={e => setPosColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer border-0" />
                <span className="text-sm text-muted-foreground">{posColor}</span>
              </div>
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
            <DialogTitle>Nova Progressão de Carreira</DialogTitle>
            <DialogDescription>Defina de qual cargo para qual cargo o membro pode progredir</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>De (cargo atual)</Label>
              <Select value={stepFrom} onValueChange={setStepFrom}>
                <SelectTrigger><SelectValue placeholder="Entrada (primeiro cargo)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entry">Entrada (primeiro cargo)</SelectItem>
                  {positions.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Para (próximo cargo) *</Label>
              <Select value={stepTo} onValueChange={setStepTo}>
                <SelectTrigger><SelectValue placeholder="Selecione o cargo destino" /></SelectTrigger>
                <SelectContent>
                  {positions.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
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
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cargo</Label>
              <Select value={assignPositionId} onValueChange={setAssignPositionId}>
                <SelectTrigger><SelectValue placeholder="Selecione um cargo" /></SelectTrigger>
                <SelectContent>
                  {positions.map(p => (
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
    </div>
  );
}
