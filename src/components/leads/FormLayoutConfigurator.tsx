import { useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, Pencil, GripVertical, ArrowUp, ArrowDown,
  ChevronRight, Eye, EyeOff, Columns2, FolderPlus, Save, X,
  Settings, MoveRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useFormLayout, FormLayoutTab, FormLayoutField } from '@/hooks/useFormLayout';
import { useLeadCustomFields, CustomField } from '@/hooks/useLeadCustomFields';

// All available native field keys with labels
const NATIVE_FIELDS: Record<string, { label: string; defaultColSpan: number }> = {
  lead_name: { label: 'Nome do Lead', defaultColSpan: 2 },
  source: { label: 'Origem', defaultColSpan: 1 },
  acolhedor: { label: 'Acolhedor', defaultColSpan: 1 },
  group_link: { label: 'Link da Notícia', defaultColSpan: 2 },
  instagram_username: { label: 'Instagram', defaultColSpan: 1 },
  client_classification: { label: 'Classificação', defaultColSpan: 1 },
  lead_outcome: { label: 'Resultado do Lead', defaultColSpan: 2 },
  notes: { label: 'Observações', defaultColSpan: 2 },
  board_id: { label: 'Funil / Quadro Kanban', defaultColSpan: 2 },
  victim_name: { label: 'Nome da Vítima', defaultColSpan: 1 },
  victim_age: { label: 'Idade da Vítima', defaultColSpan: 1 },
  accident_date: { label: 'Data do Acidente', defaultColSpan: 1 },
  case_type: { label: 'Tipo de Caso', defaultColSpan: 1 },
  accident_address: { label: 'Endereço do Acidente', defaultColSpan: 2 },
  damage_description: { label: 'Descrição do Dano', defaultColSpan: 2 },
  visit_state: { label: 'Estado da Visita', defaultColSpan: 1 },
  visit_city: { label: 'Cidade da Visita', defaultColSpan: 1 },
  visit_region: { label: 'Região da Visita', defaultColSpan: 1 },
  visit_address: { label: 'Endereço da Visita', defaultColSpan: 2 },
  contractor_company: { label: 'Empresa Terceirizada', defaultColSpan: 1 },
  main_company: { label: 'Empresa Tomadora', defaultColSpan: 1 },
  sector: { label: 'Setor', defaultColSpan: 1 },
  company_size_justification: { label: 'Justificativa do Porte', defaultColSpan: 2 },
  liability_type: { label: 'Tipo de Responsabilidade', defaultColSpan: 1 },
  news_link: { label: 'Link da Notícia (Jurídico)', defaultColSpan: 1 },
  legal_viability: { label: 'Viabilidade Jurídica', defaultColSpan: 2 },
};

// System tabs that can't be deleted
const SYSTEM_TABS = ['contacts', 'checklist', 'activities', 'history', 'config', 'ai_chat'];

const ICON_OPTIONS = [
  'User', 'Users', 'FileText', 'MapPin', 'Building', 'Briefcase',
  'Calendar', 'CheckSquare', 'History', 'Settings', 'Sparkles',
  'Heart', 'Star', 'Flag', 'Shield', 'Scale', 'Phone', 'Mail',
  'Home', 'Target', 'Folder', 'Tag', 'Clock', 'Award',
];

interface FormLayoutConfiguratorProps {
  adAccountId?: string;
}

export function FormLayoutConfigurator({ adAccountId }: FormLayoutConfiguratorProps) {
  const {
    tabs, fields, loading,
    addTab, updateTab, deleteTab, reorderTabs,
    addField, updateField, deleteField, moveField, reorderFields,
    getFieldsForTab, getPlacedFieldKeys,
  } = useFormLayout();
  const { customFields } = useLeadCustomFields(adAccountId);

  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [showAddTab, setShowAddTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [newTabIcon, setNewTabIcon] = useState('FileText');
  const [editingTab, setEditingTab] = useState<FormLayoutTab | null>(null);
  const [showAddField, setShowAddField] = useState(false);
  const [showMoveField, setShowMoveField] = useState<FormLayoutField | null>(null);

  // Get tabs that have editable fields (not pure component tabs)
  const editableTabs = tabs.filter(t => !SYSTEM_TABS.includes(t.system_key || ''));
  const selectedTab = tabs.find(t => t.id === selectedTabId);

  const handleAddTab = async () => {
    if (!newTabName.trim()) return;
    await addTab(newTabName.trim(), newTabIcon);
    setShowAddTab(false);
    setNewTabName('');
    setNewTabIcon('FileText');
  };

  const handleEditTab = async () => {
    if (!editingTab || !newTabName.trim()) return;
    await updateTab(editingTab.id, { name: newTabName.trim(), icon: newTabIcon });
    setEditingTab(null);
    setNewTabName('');
  };

  const handleDeleteTab = async (tab: FormLayoutTab) => {
    if (tab.is_system && SYSTEM_TABS.includes(tab.system_key || '')) {
      toast.error('Não é possível excluir este grupo');
      return;
    }
    if (confirm(`Excluir o grupo "${tab.name}"? Os campos serão desvinculados.`)) {
      await deleteTab(tab.id);
      if (selectedTabId === tab.id) setSelectedTabId(null);
    }
  };

  const handleMoveTabUp = async (index: number) => {
    if (index === 0) return;
    const ordered = [...tabs].sort((a, b) => a.display_order - b.display_order);
    const ids = ordered.map(t => t.id);
    [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
    await reorderTabs(ids);
  };

  const handleMoveTabDown = async (index: number) => {
    const ordered = [...tabs].sort((a, b) => a.display_order - b.display_order);
    if (index >= ordered.length - 1) return;
    const ids = ordered.map(t => t.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    await reorderTabs(ids);
  };

  // Get available fields (not yet placed) for adding
  const placedKeys = getPlacedFieldKeys();
  const availableNativeFields = Object.entries(NATIVE_FIELDS)
    .filter(([key]) => !placedKeys.includes(key));

  const placedCustomIds = fields.filter(f => f.custom_field_id).map(f => f.custom_field_id!);
  const availableCustomFields = customFields.filter(cf => !placedCustomIds.includes(cf.id));

  const handleAddNativeField = async (fieldKey: string) => {
    if (!selectedTabId) return;
    const def = NATIVE_FIELDS[fieldKey];
    await addField(selectedTabId, fieldKey, undefined, def?.defaultColSpan || 1);
    setShowAddField(false);
  };

  const handleAddCustomField = async (cf: CustomField) => {
    if (!selectedTabId) return;
    await addField(selectedTabId, undefined, cf.id, 1);
    setShowAddField(false);
  };

  const handleMoveFieldUp = async (tabId: string, index: number) => {
    const tabFields = getFieldsForTab(tabId);
    if (index === 0) return;
    const ids = tabFields.map(f => f.id);
    [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
    await reorderFields(tabId, ids);
  };

  const handleMoveFieldDown = async (tabId: string, index: number) => {
    const tabFields = getFieldsForTab(tabId);
    if (index >= tabFields.length - 1) return;
    const ids = tabFields.map(f => f.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    await reorderFields(tabId, ids);
  };

  const handleMoveFieldToTab = async (field: FormLayoutField, newTabId: string) => {
    const targetFields = getFieldsForTab(newTabId);
    const newOrder = targetFields.length;
    await moveField(field.id, newTabId, newOrder);
    setShowMoveField(null);
  };

  const getFieldLabel = (field: FormLayoutField): string => {
    if (field.label_override) return field.label_override;
    if (field.field_key && NATIVE_FIELDS[field.field_key]) {
      return NATIVE_FIELDS[field.field_key].label;
    }
    if (field.custom_field_id) {
      const cf = customFields.find(c => c.id === field.custom_field_id);
      return cf?.field_name || 'Campo personalizado';
    }
    return 'Campo desconhecido';
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground text-sm">Carregando layout...</div>;
  }

  const orderedTabs = [...tabs].sort((a, b) => a.display_order - b.display_order);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Configurar Formulário</h3>
          <p className="text-xs text-muted-foreground">Organize grupos (abas) e campos do formulário de lead</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAddTab(true)} className="gap-1">
          <FolderPlus className="h-3.5 w-3.5" />
          Novo Grupo
        </Button>
      </div>

      {/* Tabs list */}
      <div className="space-y-1">
        {orderedTabs.map((tab, index) => {
          const isSelected = selectedTabId === tab.id;
          const isSystemOnly = SYSTEM_TABS.includes(tab.system_key || '');
          const tabFields = getFieldsForTab(tab.id);

          return (
            <div key={tab.id}>
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'
                }`}
                onClick={() => setSelectedTabId(isSelected ? null : tab.id)}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                <span className="text-sm font-medium flex-1">{tab.name}</span>
                {tab.is_system && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Sistema</Badge>
                )}
                {!isSystemOnly && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {tabFields.length} campos
                  </Badge>
                )}
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleMoveTabUp(index); }}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleMoveTabDown(index); }}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  {!isSystemOnly && (
                    <>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => {
                        e.stopPropagation();
                        setEditingTab(tab);
                        setNewTabName(tab.name);
                        setNewTabIcon(tab.icon);
                      }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      {!tab.is_system && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleDeleteTab(tab); }}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Expanded tab - show fields */}
              {isSelected && !isSystemOnly && (
                <div className="ml-8 mt-1 mb-2 space-y-1">
                  {tabFields.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 px-3">Nenhum campo neste grupo</p>
                  ) : (
                    tabFields.map((field, fIndex) => (
                      <div
                        key={field.id}
                        className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted/30 border border-border/50 text-xs"
                      >
                        <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="flex-1 truncate">{getFieldLabel(field)}</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0">
                          {field.col_span === 2 ? 'Largura total' : 'Meia largura'}
                        </Badge>
                        {field.custom_field_id && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0">Custom</Badge>
                        )}
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleMoveFieldUp(tab.id, fIndex)}>
                            <ArrowUp className="h-2.5 w-2.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleMoveFieldDown(tab.id, fIndex)}>
                            <ArrowDown className="h-2.5 w-2.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-5 w-5"
                            onClick={() => updateField(field.id, { col_span: field.col_span === 2 ? 1 : 2 })}
                            title="Alternar largura"
                          >
                            <Columns2 className="h-2.5 w-2.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-5 w-5"
                            onClick={() => setShowMoveField(field)}
                            title="Mover para outro grupo"
                          >
                            <MoveRight className="h-2.5 w-2.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => deleteField(field.id)}>
                            <Trash2 className="h-2.5 w-2.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                  <Button
                    variant="outline" size="sm"
                    className="w-full mt-1 gap-1 text-xs h-7"
                    onClick={() => setShowAddField(true)}
                  >
                    <Plus className="h-3 w-3" />
                    Adicionar Campo
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Tab Dialog */}
      <Dialog open={showAddTab || !!editingTab} onOpenChange={(open) => { if (!open) { setShowAddTab(false); setEditingTab(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingTab ? 'Editar Grupo' : 'Novo Grupo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={newTabName}
                onChange={(e) => setNewTabName(e.target.value)}
                placeholder="Ex: Financeiro"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Ícone</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {ICON_OPTIONS.map(icon => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setNewTabIcon(icon)}
                    className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                      newTabIcon === icon ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-accent'
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowAddTab(false); setEditingTab(null); }}>Cancelar</Button>
            <Button size="sm" onClick={editingTab ? handleEditTab : handleAddTab} disabled={!newTabName.trim()}>
              {editingTab ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Field Dialog */}
      <Dialog open={showAddField} onOpenChange={setShowAddField}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Campo</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3 pr-2">
              {availableNativeFields.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Campos Nativos</Label>
                  <div className="space-y-1 mt-1">
                    {availableNativeFields.map(([key, def]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleAddNativeField(key)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 hover:bg-accent transition-colors text-left text-sm"
                      >
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{def.label}</span>
                        <Badge variant="outline" className="ml-auto text-[9px]">
                          {def.defaultColSpan === 2 ? 'Largura total' : 'Meia'}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {availableCustomFields.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Campos Personalizados</Label>
                  <div className="space-y-1 mt-1">
                    {availableCustomFields.map((cf) => (
                      <button
                        key={cf.id}
                        type="button"
                        onClick={() => handleAddCustomField(cf)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 hover:bg-accent transition-colors text-left text-sm"
                      >
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{cf.field_name}</span>
                        <Badge variant="secondary" className="ml-auto text-[9px]">{cf.field_type}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {availableNativeFields.length === 0 && availableCustomFields.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  Todos os campos já foram adicionados
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Move Field to Tab Dialog */}
      <Dialog open={!!showMoveField} onOpenChange={(open) => { if (!open) setShowMoveField(null); }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Mover para qual grupo?</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {editableTabs
              .filter(t => t.id !== showMoveField?.tab_id)
              .map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => showMoveField && handleMoveFieldToTab(showMoveField, tab.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-accent transition-colors text-left text-sm"
                >
                  <MoveRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{tab.name}</span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
