import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface ProcessActivity {
  title: string;
  activity_type: string;
  assigned_to: string;
  deadline_days: number;
  priority: string;
}

interface ProcessWorkflow {
  workflow_board_id: string;
  activities: ProcessActivity[];
  use_ai_activities?: boolean;
  ai_activities_prompt?: string;
}

interface Board {
  id: string;
  name: string;
  board_type?: string;
  product_service_id?: string | null;
}

interface Props {
  boardId: string;
}

export function OnboardingCaseConfig({ boardId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [autoCreate, setAutoCreate] = useState(false);
  const [workflows, setWorkflows] = useState<ProcessWorkflow[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [nuclei, setNuclei] = useState<{ id: string; name: string; prefix: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; nucleus_id: string | null }[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; full_name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [settingsRes, boardsRes, nucleiRes, productsRes, profilesRes] = await Promise.all([
        (supabase as any)
          .from('board_group_settings')
          .select('id, auto_create_process, process_workflows')
          .eq('board_id', boardId)
          .maybeSingle(),
        (supabase as any).from('kanban_boards').select('id, name, board_type, product_service_id').order('display_order'),
        (supabase as any).from('specialized_nuclei').select('id, name, prefix').eq('is_active', true).order('name'),
        (supabase as any).from('products_services').select('id, name, nucleus_id'),
        (supabase as any).from('profiles').select('user_id, full_name').order('full_name'),
      ]);
      if (cancelled) return;
      setSettingsId(settingsRes.data?.id || null);
      setAutoCreate(!!settingsRes.data?.auto_create_process);
      setWorkflows((settingsRes.data?.process_workflows as ProcessWorkflow[]) || []);
      setBoards((boardsRes.data as Board[]) || []);
      setNuclei((nucleiRes.data || []).map((n: any) => ({ id: n.id, name: n.name, prefix: n.prefix })));
      setProducts((productsRes.data || []).map((p: any) => ({ id: p.id, name: p.name, nucleus_id: p.nucleus_id })));
      setTeamMembers((profilesRes.data || []).filter((p: any) => p.full_name));
      setLoading(false);
    };
    if (boardId) load();
    return () => { cancelled = true; };
  }, [boardId]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        auto_create_process: autoCreate,
        process_workflows: workflows,
        updated_at: new Date().toISOString(),
      };
      if (settingsId) {
        await (supabase as any).from('board_group_settings').update(payload).eq('id', settingsId);
      } else {
        const { data } = await (supabase as any)
          .from('board_group_settings')
          .insert({ board_id: boardId, ...payload })
          .select('id')
          .single();
        if (data?.id) setSettingsId(data.id);
      }
      toast.success('Configuração de Caso salva');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const workflowBoards = boards.filter((b) => b.board_type === 'workflow');

  return (
    <div className="space-y-4">
      <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h4 className="font-medium text-xs">Criação Automática de Processos</h4>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Quando o lead deste funil fechar, o sistema cria automaticamente os processos jurídicos abaixo
          dentro do caso. Cada fluxo de trabalho selecionado vira um processo com seu núcleo correspondente
          e suas atividades iniciais.
        </p>

        <div className="flex items-center gap-2">
          <Checkbox
            id="case_auto_create_process"
            checked={autoCreate}
            onCheckedChange={(checked) => setAutoCreate(!!checked)}
          />
          <Label htmlFor="case_auto_create_process" className="text-xs cursor-pointer">
            ⚖️ Criar <strong>processos jurídicos</strong> automaticamente ao fechar o lead
          </Label>
        </div>

        {autoCreate && (
          <div className="space-y-3 pl-2 border-l-2 border-primary/20 ml-1">
            <Label className="text-[11px] text-muted-foreground">Selecione os fluxos de trabalho:</Label>

            {workflowBoards.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-2">
                Nenhum fluxo de trabalho cadastrado. Crie fluxos na página de Configurações.
              </p>
            )}

            {workflowBoards.map((workflow) => {
              const isSelected = workflows.some((w) => w.workflow_board_id === workflow.id);
              const entry = workflows.find((w) => w.workflow_board_id === workflow.id);
              const product = products.find((p) => p.id === workflow.product_service_id);
              const nucleus = product?.nucleus_id ? nuclei.find((n) => n.id === product.nucleus_id) : null;

              return (
                <div key={workflow.id} className="rounded-lg border bg-background">
                  <label className="flex items-center gap-2 p-2 cursor-pointer">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setWorkflows((prev) => [...prev, { workflow_board_id: workflow.id, activities: [] }]);
                        } else {
                          setWorkflows((prev) => prev.filter((w) => w.workflow_board_id !== workflow.id));
                        }
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{workflow.name}</span>
                      {nucleus && (
                        <span className="text-[10px] text-muted-foreground ml-2">({nucleus.prefix} - {nucleus.name})</span>
                      )}
                    </div>
                  </label>

                  {isSelected && entry && (
                    <div className="px-2 pb-2 space-y-2 border-t mx-2 pt-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-muted-foreground">Atividades automáticas</Label>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 cursor-pointer">
                            <Checkbox
                              checked={entry.use_ai_activities || false}
                              onCheckedChange={(checked) =>
                                setWorkflows((prev) =>
                                  prev.map((w) => (w.workflow_board_id === workflow.id ? { ...w, use_ai_activities: !!checked } : w))
                                )
                              }
                              className="h-3 w-3"
                            />
                            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                              <Sparkles className="h-2.5 w-2.5" /> Gerar com IA
                            </span>
                          </label>
                          {!entry.use_ai_activities && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-5 text-[9px] gap-1 px-2"
                              onClick={() =>
                                setWorkflows((prev) =>
                                  prev.map((w) =>
                                    w.workflow_board_id === workflow.id
                                      ? {
                                          ...w,
                                          activities: [
                                            ...w.activities,
                                            { title: '', activity_type: 'tarefa', assigned_to: '', deadline_days: 1, priority: 'normal' },
                                          ],
                                        }
                                      : w
                                  )
                                )
                              }
                            >
                              + Atividade
                            </Button>
                          )}
                        </div>
                      </div>

                      {entry.use_ai_activities ? (
                        <div className="space-y-1.5">
                          <p className="text-[9px] text-muted-foreground">
                            A IA gerará atividades automaticamente com base no prompt do agente, mensagens e cargos da equipe.
                          </p>
                          <Textarea
                            value={entry.ai_activities_prompt || ''}
                            onChange={(e) =>
                              setWorkflows((prev) =>
                                prev.map((w) => (w.workflow_board_id === workflow.id ? { ...w, ai_activities_prompt: e.target.value } : w))
                              )
                            }
                            rows={4}
                            className="text-[9px] font-mono leading-relaxed"
                            placeholder="Instruções adicionais para a IA (opcional)."
                          />
                        </div>
                      ) : (
                        <>
                          {entry.activities.map((act, actIdx) => (
                            <div key={actIdx} className="p-1.5 rounded border bg-muted/30 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-medium text-muted-foreground">Atividade {actIdx + 1}</span>
                                <button
                                  type="button"
                                  className="text-destructive hover:text-destructive/80 text-[9px]"
                                  onClick={() =>
                                    setWorkflows((prev) =>
                                      prev.map((w) =>
                                        w.workflow_board_id === workflow.id
                                          ? { ...w, activities: w.activities.filter((_, i) => i !== actIdx) }
                                          : w
                                      )
                                    )
                                  }
                                >
                                  ✕
                                </button>
                              </div>
                              <Input
                                value={act.title}
                                placeholder="Título da atividade"
                                className="h-6 text-[10px]"
                                onChange={(e) =>
                                  setWorkflows((prev) =>
                                    prev.map((w) =>
                                      w.workflow_board_id === workflow.id
                                        ? {
                                            ...w,
                                            activities: w.activities.map((a, i) => (i === actIdx ? { ...a, title: e.target.value } : a)),
                                          }
                                        : w
                                    )
                                  )
                                }
                              />
                              <div className="grid grid-cols-3 gap-1.5">
                                <div>
                                  <Label className="text-[9px] text-muted-foreground">Responsável</Label>
                                  <Select
                                    value={act.assigned_to}
                                    onValueChange={(v) =>
                                      setWorkflows((prev) =>
                                        prev.map((w) =>
                                          w.workflow_board_id === workflow.id
                                            ? {
                                                ...w,
                                                activities: w.activities.map((a, i) => (i === actIdx ? { ...a, assigned_to: v } : a)),
                                              }
                                            : w
                                        )
                                      )
                                    }
                                  >
                                    <SelectTrigger className="h-6 text-[9px]">
                                      <SelectValue placeholder="Selecionar..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {teamMembers.map((m) => (
                                        <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-[9px] text-muted-foreground">Prazo (dias)</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={act.deadline_days}
                                    className="h-6 text-[9px]"
                                    onChange={(e) =>
                                      setWorkflows((prev) =>
                                        prev.map((w) =>
                                          w.workflow_board_id === workflow.id
                                            ? {
                                                ...w,
                                                activities: w.activities.map((a, i) =>
                                                  i === actIdx ? { ...a, deadline_days: parseInt(e.target.value) || 1 } : a
                                                ),
                                              }
                                            : w
                                        )
                                      )
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="text-[9px] text-muted-foreground">Prioridade</Label>
                                  <Select
                                    value={act.priority}
                                    onValueChange={(v) =>
                                      setWorkflows((prev) =>
                                        prev.map((w) =>
                                          w.workflow_board_id === workflow.id
                                            ? {
                                                ...w,
                                                activities: w.activities.map((a, i) => (i === actIdx ? { ...a, priority: v } : a)),
                                              }
                                            : w
                                        )
                                      )
                                    }
                                  >
                                    <SelectTrigger className="h-6 text-[9px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="baixa">Baixa</SelectItem>
                                      <SelectItem value="normal">Normal</SelectItem>
                                      <SelectItem value="alta">Alta</SelectItem>
                                      <SelectItem value="urgente">Urgente</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>
                          ))}
                          {entry.activities.length === 0 && (
                            <p className="text-[9px] text-muted-foreground text-center py-1">Sem atividades automáticas.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {workflows.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                ✅ {workflows.length} processo(s) será(ão) criado(s) automaticamente.
              </p>
            )}
          </div>
        )}
      </div>

      <Button size="sm" onClick={save} disabled={saving} className="w-full h-8 text-xs">
        {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
        Salvar Configurações de Caso
      </Button>
    </div>
  );
}
