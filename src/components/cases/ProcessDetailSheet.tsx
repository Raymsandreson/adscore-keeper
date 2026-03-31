import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  FileText, MapPin, Building2, Scale, Users, Calendar, ExternalLink,
  Hash, Info, BookOpen, Landmark, Save, Loader2, Pencil, RefreshCw, ClipboardList, CheckCircle2, Clock
} from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ProcessDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  process: any;
  onUpdated?: () => void;
  mode?: 'sheet' | 'dialog';
}

function formatDateBR(val: string): string {
  if (!val) return '';
  const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return val;
}

function parseDateBR(val: string): string {
  const match = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return val;
}

function EditableField({ label, value, onChange, type = 'text', icon: Icon, isDate = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; icon?: any; isDate?: boolean;
}) {
  const displayValue = isDate ? formatDateBR(value) : value;
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </Label>
      <Input
        value={displayValue}
        onChange={e => {
          if (isDate) {
            const raw = e.target.value;
            if (raw.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
              onChange(parseDateBR(raw));
            } else {
              onChange(raw);
            }
          } else {
            onChange(e.target.value);
          }
        }}
        onBlur={isDate ? (e) => {
          const parsed = parseDateBR(e.target.value);
          if (parsed !== e.target.value) onChange(parsed);
        } : undefined}
        className="h-8 text-xs"
        type={type}
        placeholder={isDate ? 'DD/MM/AAAA' : undefined}
      />
    </div>
  );
}

function EditableTextarea({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Textarea value={value} onChange={e => onChange(e.target.value)} className="text-xs min-h-[60px]" />
    </div>
  );
}

function EditableSwitch({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

const TABS = [
  { id: 'partes', label: 'Partes', icon: Users },
  { id: 'dados', label: 'Dados', icon: Scale },
  { id: 'tribunal', label: 'Tribunal', icon: Landmark },
  { id: 'local', label: 'Local', icon: MapPin },
  { id: 'datas', label: 'Datas', icon: Calendar },
  { id: 'atividades', label: 'Histórico', icon: ClipboardList },
  { id: 'config', label: 'Config', icon: Info },
  { id: 'notas', label: 'Notas', icon: FileText },
  { id: 'envolvidos', label: 'Envolvidos', icon: Users },
] as const;

type TabId = typeof TABS[number]['id'];

interface ProcessActivity {
  id: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string;
  deadline: string | null;
  assigned_to_name: string | null;
  completed_at: string | null;
  created_at: string;
}

export default function ProcessDetailSheet({ open, onOpenChange, process, onUpdated, mode = 'sheet' }: ProcessDetailSheetProps) {
  const navFn = useNavigate();
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('partes');
  const [activities, setActivities] = useState<ProcessActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  useEffect(() => {
    if (process) {
      setForm({ ...process });
      setDirty(false);
      setActiveTab('partes');
      setActivities([]);
    }
  }, [process]);

  // Fetch activities when the tab is activated
  useEffect(() => {
    if (activeTab !== 'atividades' || !process?.id) return;
    setLoadingActivities(true);
    supabase
      .from('lead_activities')
      .select('id, title, description, activity_type, status, priority, deadline, assigned_to_name, completed_at, created_at')
      .eq('process_id', process.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setActivities((data || []) as ProcessActivity[]);
        setLoadingActivities(false);
      });
  }, [activeTab, process?.id]);

  const set = useCallback((key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleFetchFromApi = async () => {
    if (!form.process_number) {
      toast.error('Número do processo não encontrado para buscar no Escavador');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await cloudFunctions.invoke('search-escavador', {
        body: { action: 'buscar_completo', numero_cnj: form.process_number },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const result = data.data;
      const fonte = result.fontes?.[0];
      const capa = fonte?.capa || {};
      const valorCausa = capa?.valor_causa || {};

      const updates: Record<string, any> = {
        polo_ativo: result.titulo_polo_ativo || form.polo_ativo,
        polo_passivo: result.titulo_polo_passivo || form.polo_passivo,
        ano_inicio: result.ano_inicio || form.ano_inicio,
        tribunal: fonte?.tribunal?.nome || fonte?.nome || form.tribunal,
        tribunal_sigla: fonte?.tribunal?.sigla || fonte?.sigla || form.tribunal_sigla,
        grau: fonte?.grau_formatado || fonte?.grau || form.grau,
        classe: capa?.classe || fonte?.classe?.nome || form.classe,
        area: capa?.area || fonte?.area?.nome || form.area,
        assuntos: capa?.assuntos_normalizados?.map((a: any) => a.nome) || fonte?.assuntos?.map((a: any) => a.nome) || form.assuntos,
        valor_causa: valorCausa?.valor ? parseFloat(valorCausa.valor) : form.valor_causa,
        valor_causa_formatado: valorCausa?.valor_formatado || form.valor_causa_formatado,
        situacao: capa?.situacao || fonte?.situacao || form.situacao,
        data_distribuicao: capa?.data_distribuicao || form.data_distribuicao,
        envolvidos: fonte?.envolvidos || form.envolvidos,
        movimentacoes: result.movimentacoes_detalhadas || fonte?.movimentacoes || form.movimentacoes,
        escavador_raw: result,
      };

      await supabase.from('lead_processes').update(updates).eq('id', process.id);
      setForm(prev => ({ ...prev, ...updates }));
      setDirty(false);
      onUpdated?.();
      toast.success('Dados atualizados do Escavador com sucesso');
    } catch (err: any) {
      console.error('Fetch from API error:', err);
      toast.error(err.message || 'Erro ao buscar no Escavador');
    } finally {
      setSaving(false);
    }
  };

  const handleReExtract = async () => {
    const raw = form.escavador_raw;
    if (!raw) {
      toast.error('Dados brutos do Escavador não encontrados');
      return;
    }
    const fonte: any = raw.fontes?.[0] || {};
    const capa: any = fonte?.capa || {};
    const valorCausa = capa?.valor_causa || {};
    const estadoOrigem = raw.estado_origem || {};
    const unidadeOrigem = raw.unidade_origem || {};
    const orgaoNorm = capa?.orgao_julgador_normatizado || {};

    const extracted: Record<string, any> = {
      classe: capa?.classe || fonte?.classe?.nome || null,
      area: capa?.area || fonte?.area?.nome || null,
      assunto_principal: capa?.assunto_principal_normalizado?.nome || capa?.assunto || null,
      assuntos: capa?.assuntos_normalizados?.map((a: any) => a.nome) || fonte?.assuntos?.map((a: any) => a.nome) || null,
      orgao_julgador: capa?.orgao_julgador || null,
      valor_causa: valorCausa?.valor ? parseFloat(valorCausa.valor) : (raw.valor_causa || null),
      valor_causa_formatado: valorCausa?.valor_formatado || null,
      moeda: valorCausa?.moeda || null,
      situacao: capa?.situacao || fonte?.situacao || fonte?.status_predito || null,
      data_distribuicao: capa?.data_distribuicao || null,
      data_arquivamento: capa?.data_arquivamento || null,
      informacoes_complementares: capa?.informacoes_complementares || null,
      tribunal: fonte?.tribunal?.nome || fonte?.descricao || fonte?.nome || null,
      tribunal_sigla: fonte?.tribunal?.sigla || fonte?.sigla || null,
      grau: fonte?.grau_formatado || fonte?.grau || null,
      sistema: fonte?.sistema || null,
      url_tribunal: fonte?.url || null,
      segredo_justica: fonte?.segredo_justica ?? null,
      arquivado: fonte?.arquivado ?? null,
      status_predito: fonte?.status_predito || null,
      fisico: fonte?.fisico ?? null,
      estado_origem: estadoOrigem?.nome || orgaoNorm?.estado?.nome || null,
      estado_origem_sigla: estadoOrigem?.sigla || orgaoNorm?.estado?.sigla || null,
      unidade_origem: unidadeOrigem?.nome || orgaoNorm?.nome || null,
      unidade_origem_endereco: unidadeOrigem?.endereco || orgaoNorm?.endereco || null,
      unidade_origem_classificacao: unidadeOrigem?.classificacao || orgaoNorm?.classificacao || null,
      unidade_origem_cidade: unidadeOrigem?.cidade || orgaoNorm?.cidade || null,
      polo_ativo: raw.titulo_polo_ativo || null,
      polo_passivo: raw.titulo_polo_passivo || null,
      ano_inicio: raw.ano_inicio || null,
      data_inicio: raw.data_inicio || null,
      data_ultima_movimentacao: (() => {
        const allMovs = raw.movimentacoes || fonte?.movimentacoes || [];
        if (Array.isArray(allMovs) && allMovs.length > 0) {
          const sorted = [...allMovs].sort((a: any, b: any) => 
            new Date(b.data || b.data_hora || '').getTime() - new Date(a.data || a.data_hora || '').getTime()
          );
          return sorted[0]?.data || sorted[0]?.data_hora?.split('T')[0] || null;
        }
        return raw.data_ultima_movimentacao || fonte?.data_ultima_movimentacao || null;
      })(),
      quantidade_movimentacoes: raw.quantidade_movimentacoes || null,
      data_ultima_verificacao: raw.data_ultima_verificacao || null,
      audiencias: fonte?.audiencias || null,
      envolvidos: fonte?.envolvidos || null,
      fonte_nome: fonte?.nome || fonte?.descricao || null,
      fonte_tipo: fonte?.tipo || null,
      fonte_data_inicio: fonte?.data_inicio || null,
      fonte_data_fim: fonte?.data_ultima_movimentacao || null,
    };

    // Overwrite ALL fields that have data from Escavador (not just empty ones)
    const updates: Record<string, any> = {};
    let count = 0;
    for (const [key, val] of Object.entries(extracted)) {
      if (val != null && val !== '') {
        updates[key] = val;
        count++;
      }
    }

    if (count === 0) {
      toast.info('Nenhum dado encontrado no Escavador para extrair');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('lead_processes').update(updates).eq('id', process.id);
      if (error) throw error;
      setForm(prev => ({ ...prev, ...updates }));
      toast.success(`${count} campos atualizados a partir dos dados do Escavador`);
      onUpdated?.();
    } catch (err: any) {
      toast.error('Erro: ' + (err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!process?.id) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      const editableKeys = [
        'title', 'process_number', 'status', 'process_type', 'polo_ativo', 'polo_passivo',
        'classe', 'area', 'assunto_principal', 'orgao_julgador', 'valor_causa', 'valor_causa_formatado',
        'fee_percentage', 'estimated_fee_value', 'informacoes_complementares',
        'tribunal', 'tribunal_sigla', 'grau', 'sistema', 'fonte_nome', 'fonte_tipo', 'url_tribunal',
        'estado_origem', 'estado_origem_sigla', 'unidade_origem', 'unidade_origem_endereco',
        'unidade_origem_classificacao', 'unidade_origem_cidade',
        'ano_inicio', 'data_inicio', 'data_distribuicao', 'fonte_data_inicio', 'fonte_data_fim',
        'data_ultima_movimentacao', 'data_arquivamento', 'data_ultima_verificacao',
        'quantidade_movimentacoes', 'segredo_justica', 'arquivado', 'fisico',
        'status_predito', 'situacao', 'moeda', 'description', 'notes',
        'workflow_id', 'workflow_name', 'workflow_stage_id',
      ];

      for (const key of editableKeys) {
        if (form[key] !== process[key]) {
          let val = form[key];
          if (val === '') val = null;
          if (['ano_inicio', 'quantidade_movimentacoes'].includes(key) && val != null) val = Number(val) || null;
          if (['fee_percentage', 'estimated_fee_value', 'valor_causa'].includes(key) && val != null) val = parseFloat(val) || null;
          payload[key] = val;
        }
      }

      if (Object.keys(payload).length === 0) {
        toast.info('Nenhuma alteração detectada');
        setSaving(false);
        return;
      }

      const { error } = await supabase.from('lead_processes').update(payload).eq('id', process.id);
      if (error) throw error;
      toast.success('Processo atualizado');
      setDirty(false);
      onUpdated?.();
    } catch (err: any) {
      console.error('Error updating process:', err);
      toast.error('Erro ao salvar: ' + (err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  if (!process) return null;

  const envolvidos = Array.isArray(form.envolvidos) ? form.envolvidos : [];
  const audiencias = Array.isArray(form.audiencias) ? form.audiencias : [];
  const processosRelacionados = Array.isArray(form.processos_relacionados) ? form.processos_relacionados : [];

  const innerContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 pb-2 flex flex-row items-center justify-between shrink-0">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Pencil className="h-4 w-4 text-primary" />
          Detalhes do Processo
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={form.escavador_raw ? handleReExtract : handleFetchFromApi} disabled={saving} className="h-7 text-xs gap-1">
            <RefreshCw className="h-3 w-3" />
            {form.escavador_raw ? 'Re-extrair' : 'Buscar no Escavador'}
          </Button>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Salvar
            </Button>
          )}
        </div>
      </div>

      {/* Process info */}
      <div className="px-4 pb-2 space-y-2 border-b shrink-0">
        <EditableField label="Título" value={form.title || ''} onChange={v => set('title', v)} />
        <EditableField label="Nº do Processo" value={form.process_number || ''} onChange={v => set('process_number', v)} icon={Hash} />
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-[10px]">
            {form.status === 'em_andamento' ? 'Em Andamento' : form.status === 'concluido' ? 'Concluído' : form.status === 'arquivado' ? 'Arquivado' : form.status}
          </Badge>
          {form.situacao && <Badge variant="outline" className="text-[10px]">{form.situacao}</Badge>}
          {form.segredo_justica && <Badge variant="destructive" className="text-[10px]">Segredo de Justiça</Badge>}
          <Button
            variant="link"
            size="sm"
            className="h-5 text-[10px] gap-1 px-1 text-primary"
            onClick={() => {
              onOpenChange(false);
              navFn(`/processes?openProcess=${process.id}`);
            }}
          >
            <ExternalLink className="h-3 w-3" />
            Ver na aba Processos
          </Button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="shrink-0 border-b">
        <ScrollArea className="w-full">
          <div className="flex gap-0.5 px-2 py-1.5 overflow-x-auto">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              if (tab.id === 'envolvidos' && envolvidos.length === 0 && audiencias.length === 0 && processosRelacionados.length === 0) return null;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
          <div className="space-y-3 pt-3">

            {activeTab === 'partes' && (
              <>
                <EditableField label="Polo Ativo (Autor)" value={form.polo_ativo || ''} onChange={v => set('polo_ativo', v)} />
                <EditableField label="Polo Passivo (Réu)" value={form.polo_passivo || ''} onChange={v => set('polo_passivo', v)} />
              </>
            )}

            {activeTab === 'dados' && (
              <>
                <EditableField label="Classe" value={form.classe || ''} onChange={v => set('classe', v)} icon={BookOpen} />
                <EditableField label="Área" value={form.area || ''} onChange={v => set('area', v)} icon={Landmark} />
                <EditableField label="Assunto Principal" value={form.assunto_principal || ''} onChange={v => set('assunto_principal', v)} />
                <EditableField label="Órgão Julgador" value={form.orgao_julgador || ''} onChange={v => set('orgao_julgador', v)} icon={Building2} />
                <EditableField label="Valor da Causa" value={form.valor_causa != null ? String(form.valor_causa) : ''} onChange={v => set('valor_causa', v)} type="number" />
                <EditableField label="Valor Formatado" value={form.valor_causa_formatado || ''} onChange={v => set('valor_causa_formatado', v)} />
                <EditableField label="Honorários (%)" value={form.fee_percentage != null ? String(form.fee_percentage) : ''} onChange={v => set('fee_percentage', v)} type="number" />
                <EditableField label="Valor Estimado Honorários" value={form.estimated_fee_value != null ? String(form.estimated_fee_value) : ''} onChange={v => set('estimated_fee_value', v)} type="number" />
                <EditableField label="Situação" value={form.situacao || ''} onChange={v => set('situacao', v)} />
                <EditableField label="Status Predito" value={form.status_predito || ''} onChange={v => set('status_predito', v)} />
                <EditableTextarea label="Informações Complementares" value={form.informacoes_complementares || ''} onChange={v => set('informacoes_complementares', v)} />
              </>
            )}

            {activeTab === 'tribunal' && (
              <>
                <EditableField label="Tribunal" value={form.tribunal || ''} onChange={v => set('tribunal', v)} />
                <EditableField label="Sigla" value={form.tribunal_sigla || ''} onChange={v => set('tribunal_sigla', v)} />
                <EditableField label="Grau" value={form.grau || ''} onChange={v => set('grau', v)} />
                <EditableField label="Sistema" value={form.sistema || ''} onChange={v => set('sistema', v)} />
                <EditableField label="Fonte" value={form.fonte_nome || ''} onChange={v => set('fonte_nome', v)} />
                <EditableField label="Tipo da Fonte" value={form.fonte_tipo || ''} onChange={v => set('fonte_tipo', v)} />
                <EditableField label="URL do Tribunal" value={form.url_tribunal || ''} onChange={v => set('url_tribunal', v)} />
                {form.url_tribunal && (
                  <a href={form.url_tribunal} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> Abrir no tribunal
                  </a>
                )}
              </>
            )}

            {activeTab === 'local' && (
              <>
                <EditableField label="Estado" value={form.estado_origem || ''} onChange={v => set('estado_origem', v)} />
                <EditableField label="Sigla UF" value={form.estado_origem_sigla || ''} onChange={v => set('estado_origem_sigla', v)} />
                <EditableField label="Unidade de Origem" value={form.unidade_origem || ''} onChange={v => set('unidade_origem', v)} icon={Building2} />
                <EditableField label="Endereço" value={form.unidade_origem_endereco || ''} onChange={v => set('unidade_origem_endereco', v)} />
                <EditableField label="Classificação" value={form.unidade_origem_classificacao || ''} onChange={v => set('unidade_origem_classificacao', v)} />
                <EditableField label="Cidade" value={form.unidade_origem_cidade || ''} onChange={v => set('unidade_origem_cidade', v)} />
              </>
            )}

            {activeTab === 'datas' && (
              <>
                <EditableField label="Ano de Início" value={form.ano_inicio != null ? String(form.ano_inicio) : ''} onChange={v => set('ano_inicio', v)} type="number" />
                <EditableField label="Data de Início" value={form.data_inicio || ''} onChange={v => set('data_inicio', v)} isDate />
                <EditableField label="Data de Distribuição" value={form.data_distribuicao || ''} onChange={v => set('data_distribuicao', v)} isDate />
                <EditableField label="Data Início na Fonte" value={form.fonte_data_inicio || ''} onChange={v => set('fonte_data_inicio', v)} isDate />
                <EditableField label="Data Fim na Fonte" value={form.fonte_data_fim || ''} onChange={v => set('fonte_data_fim', v)} isDate />
                <EditableField label="Última Movimentação" value={form.data_ultima_movimentacao || ''} onChange={v => set('data_ultima_movimentacao', v)} isDate />
                <EditableField label="Data de Arquivamento" value={form.data_arquivamento || ''} onChange={v => set('data_arquivamento', v)} isDate />
                <EditableField label="Última Verificação" value={form.data_ultima_verificacao || ''} onChange={v => set('data_ultima_verificacao', v)} isDate />
                <EditableField label="Qtd. Movimentações" value={form.quantidade_movimentacoes != null ? String(form.quantidade_movimentacoes) : ''} onChange={v => set('quantidade_movimentacoes', v)} type="number" icon={Hash} />
              </>
            )}

            {activeTab === 'config' && (
              <>
                <EditableSwitch label="Segredo de Justiça" checked={!!form.segredo_justica} onChange={v => set('segredo_justica', v)} />
                <EditableSwitch label="Arquivado" checked={!!form.arquivado} onChange={v => set('arquivado', v)} />
                <EditableSwitch label="Processo Físico" checked={!!form.fisico} onChange={v => set('fisico', v)} />
                <EditableField label="Fluxo de Trabalho" value={form.workflow_name || ''} onChange={v => set('workflow_name', v)} />
              </>
            )}

            {activeTab === 'atividades' && (
              <div className="space-y-2">
                {loadingActivities ? (
                  <div className="text-center py-6 text-muted-foreground text-xs">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                    Carregando atividades...
                  </div>
                ) : activities.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <ClipboardList className="h-6 w-6 mx-auto mb-1 opacity-50" />
                    <p className="text-xs">Nenhuma atividade vinculada a este processo.</p>
                  </div>
                ) : (
                  activities.map(act => {
                    const isDone = act.status === 'concluida' || act.status === 'concluído';
                    const statusLabel = isDone ? 'Concluída' : act.status === 'pendente' ? 'Pendente' : act.status === 'em_andamento' ? 'Em andamento' : act.status;
                    const statusColor = isDone
                      ? 'bg-muted text-muted-foreground'
                      : act.status === 'em_andamento'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
                    const createdDate = act.created_at ? new Date(act.created_at).toLocaleDateString('pt-BR') : '';
                    const deadlineDate = act.deadline ? new Date(act.deadline + 'T00:00:00').toLocaleDateString('pt-BR') : '';
                    const completedDate = act.completed_at ? new Date(act.completed_at).toLocaleDateString('pt-BR') : '';
                    let duration = '';
                    if (act.created_at) {
                      const start = new Date(act.created_at);
                      const end = act.completed_at ? new Date(act.completed_at) : new Date();
                      const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                      duration = days > 0 ? `${days} dia${days > 1 ? 's' : ''}` : '';
                    }
                    return (
                      <div key={act.id} className={`border rounded-lg p-3 space-y-1.5 cursor-pointer hover:bg-muted/50 transition-colors ${isDone ? 'opacity-60' : 'border-primary/30'}`} onClick={() => navFn(`/?openActivity=${act.id}`)}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            {isDone ? <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /> : <Clock className="h-3.5 w-3.5 text-primary" />}
                            <span className="text-xs font-medium">{act.title}</span>
                          </div>
                          <Badge className={`text-[9px] ${statusColor}`}>{statusLabel}</Badge>
                        </div>
                        {act.description && <p className="text-[10px] text-muted-foreground pl-5">{act.description}</p>}
                        {duration && <p className="text-[10px] text-muted-foreground pl-5">Tempo: {duration}</p>}
                        <div className="flex items-center gap-3 pl-5 text-[10px] text-muted-foreground">
                          {createdDate && <span>Criada: {createdDate}</span>}
                          {deadlineDate && <span className="text-primary font-medium">Prazo: {deadlineDate}</span>}
                          {completedDate && <span className="text-destructive">Concluída: {completedDate}</span>}
                        </div>
                        {act.assigned_to_name && <p className="text-[10px] text-muted-foreground pl-5">Responsável: {act.assigned_to_name}</p>}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'notas' && (
              <>
                <EditableTextarea label="Descrição" value={form.description || ''} onChange={v => set('description', v)} />
                <EditableTextarea label="Notas" value={form.notes || ''} onChange={v => set('notes', v)} />
              </>
            )}

            {activeTab === 'envolvidos' && (
              <>
                {envolvidos.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-primary" />Envolvidos ({envolvidos.length})</h4>
                    <div className="space-y-2">
                      {envolvidos.map((env: any, i: number) => (
                        <div key={i} className="border rounded p-2 bg-muted/30 space-y-0.5">
                          <p className="text-xs font-medium">{env.nome || env.nome_normalizado || 'N/A'}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(env.tipo_normalizado || env.tipo) && <Badge variant="outline" className="text-[9px]">{env.tipo_normalizado || env.tipo}</Badge>}
                            {env.polo && env.polo !== 'NENHUM' && <Badge variant="secondary" className="text-[9px]">Polo {env.polo}</Badge>}
                          </div>
                          {env.cpf && <p className="text-[10px] text-muted-foreground">CPF: {env.cpf}</p>}
                          {env.oabs?.length > 0 && <p className="text-[10px] text-muted-foreground">OAB: {env.oabs.map((o: any) => `${o.numero}/${o.uf}`).join(', ')}</p>}
                          {env.advogados?.length > 0 && (
                            <div className="ml-3 mt-1 space-y-1">
                              {env.advogados.map((adv: any, j: number) => (
                                <div key={j} className="text-[10px]">
                                  <span className="font-medium">Adv:</span> {adv.nome || adv.nome_normalizado}
                                  {adv.oabs?.length > 0 && ` (OAB: ${adv.oabs.map((o: any) => `${o.numero}/${o.uf}`).join(', ')})`}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {audiencias.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-primary" />Audiências ({audiencias.length})</h4>
                    <div className="space-y-1.5">
                      {audiencias.map((aud: any, i: number) => (
                        <div key={i} className="border rounded p-2 bg-muted/30">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium">{aud.tipo || 'Audiência'}</p>
                            {aud.situacao && <Badge variant="outline" className="text-[9px]">{aud.situacao}</Badge>}
                          </div>
                          <p className="text-[10px] text-muted-foreground">{aud.data}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {processosRelacionados.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Scale className="h-3.5 w-3.5 text-primary" />Processos Relacionados ({processosRelacionados.length})</h4>
                    <div className="space-y-1">
                      {processosRelacionados.map((pr: any, i: number) => (
                        <p key={i} className="text-xs font-mono text-muted-foreground">{pr.numero || JSON.stringify(pr)}</p>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Save button at bottom */}
            {dirty && (
              <div className="sticky bottom-0 bg-background pt-2 pb-4 border-t">
                <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar alterações
                </Button>
              </div>
            )}
          </div>
        </div>
    </div>
  );

  if (mode === 'dialog') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl h-[85vh] max-h-[85vh] p-0 overflow-hidden flex flex-col">
          <div className="sr-only"><DialogHeader><DialogTitle>Detalhes do Processo</DialogTitle></DialogHeader></div>
          {innerContent}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
        <div className="sr-only"><SheetHeader><SheetTitle>Detalhes do Processo</SheetTitle></SheetHeader></div>
        {innerContent}
      </SheetContent>
    </Sheet>
  );
}
