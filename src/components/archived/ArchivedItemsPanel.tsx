import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Archive, RotateCcw, Trash2, Search, Users, Target, ListTodo, Bot } from 'lucide-react';
import { logAudit } from '@/hooks/useAuditLog';

interface ArchivedItem {
  id: string;
  name: string;
  type: 'lead' | 'contact' | 'activity' | 'agent';
  deleted_at: string;
  extra?: string;
  raw?: any;
}

export default function ArchivedItemsPanel() {
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('leads');
  const [confirmAction, setConfirmAction] = useState<{ item: ArchivedItem; action: 'restore' | 'delete' } | null>(null);

  const fetchArchived = useCallback(async (type: string) => {
    setLoading(true);
    try {
      let results: ArchivedItem[] = [];

      if (type === 'leads') {
        const { data } = await supabase
          .from('leads')
          .select('id, lead_name, deleted_at, city, state, lead_status')
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false });
        results = (data || []).map(l => ({
          id: l.id,
          name: l.lead_name || 'Lead sem nome',
          type: 'lead' as const,
          deleted_at: l.deleted_at!,
          extra: [l.city, l.state].filter(Boolean).join(', '),
          raw: l,
        }));
      } else if (type === 'contacts') {
        const { data } = await supabase
          .from('contacts')
          .select('id, full_name, deleted_at, phone, email')
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false });
        results = (data || []).map(c => ({
          id: c.id,
          name: c.full_name || 'Contato sem nome',
          type: 'contact' as const,
          deleted_at: c.deleted_at!,
          extra: c.phone || c.email || '',
          raw: c,
        }));
      } else if (type === 'activities') {
        const { data } = await supabase
          .from('lead_activities')
          .select('id, title, deleted_at, activity_type, lead_name')
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false });
        results = (data || []).map(a => ({
          id: a.id,
          name: a.title || 'Atividade sem título',
          type: 'activity' as const,
          deleted_at: a.deleted_at!,
          extra: a.lead_name || a.activity_type || '',
          raw: a,
        }));
      } else if (type === 'agents') {
        const { data } = await supabase
          .from('wjia_command_shortcuts' as any)
          .select('id, shortcut_name, deleted_at, description')
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false });
        results = ((data || []) as any[]).map(a => ({
          id: a.id,
          name: a.shortcut_name || 'Agente sem nome',
          type: 'agent' as const,
          deleted_at: a.deleted_at,
          extra: a.description || '',
          raw: a,
        }));
      }

      setItems(results);
    } catch (error) {
      console.error('Error fetching archived items:', error);
      toast.error('Erro ao carregar arquivados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArchived(activeTab);
  }, [activeTab, fetchArchived]);

  const handleRestore = async (item: ArchivedItem) => {
    try {
      const table = item.type === 'lead' ? 'leads'
        : item.type === 'contact' ? 'contacts'
        : item.type === 'activity' ? 'lead_activities'
        : 'wjia_command_shortcuts';

      const { error } = await supabase
        .from(table as any)
        .update({ deleted_at: null } as any)
        .eq('id', item.id);

      if (error) throw error;

      await logAudit({
        action: 'update',
        entityType: item.type,
        entityId: item.id,
        entityName: item.name,
        details: { action: 'restored_from_archive' },
      });

      toast.success(`"${item.name}" restaurado com sucesso`);
      fetchArchived(activeTab);
    } catch (error) {
      console.error('Error restoring item:', error);
      toast.error('Erro ao restaurar item');
    }
  };

  const handlePermanentDelete = async (item: ArchivedItem) => {
    try {
      const table = item.type === 'lead' ? 'leads'
        : item.type === 'contact' ? 'contacts'
        : item.type === 'activity' ? 'lead_activities'
        : 'wjia_command_shortcuts';

      const { error } = await supabase
        .from(table as any)
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      await logAudit({
        action: 'delete',
        entityType: item.type,
        entityId: item.id,
        entityName: item.name,
        details: { action: 'permanent_delete' },
      });

      toast.success(`"${item.name}" excluído permanentemente`);
      fetchArchived(activeTab);
    } catch (error) {
      console.error('Error permanently deleting item:', error);
      toast.error('Erro ao excluir permanentemente');
    }
  };

  const filteredItems = items.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.extra || '').toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return d; }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'leads': return <Target className="h-4 w-4" />;
      case 'contacts': return <Users className="h-4 w-4" />;
      case 'activities': return <ListTodo className="h-4 w-4" />;
      case 'agents': return <Bot className="h-4 w-4" />;
      default: return <Archive className="h-4 w-4" />;
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Archive className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-bold">Itens Arquivados</h1>
          <p className="text-sm text-muted-foreground">Restaure ou exclua permanentemente itens arquivados</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar nos arquivados..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="leads" className="gap-1.5 text-xs">
            {typeIcon('leads')} Leads
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-1.5 text-xs">
            {typeIcon('contacts')} Contatos
          </TabsTrigger>
          <TabsTrigger value="activities" className="gap-1.5 text-xs">
            {typeIcon('activities')} Atividades
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5 text-xs">
            {typeIcon('agents')} Agentes
          </TabsTrigger>
        </TabsList>

        {['leads', 'contacts', 'activities', 'agents'].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-4 space-y-2">
            {loading ? (
              <p className="text-center text-muted-foreground py-8">Carregando...</p>
            ) : filteredItems.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nenhum item arquivado</p>
            ) : (
              filteredItems.map(item => (
                <Card key={item.id} className="border-dashed">
                  <CardContent className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {item.extra && <span className="text-xs text-muted-foreground truncate">{item.extra}</span>}
                        <Badge variant="outline" className="text-[10px]">
                          Arquivado em {formatDate(item.deleted_at)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 text-xs"
                        onClick={() => setConfirmAction({ item, action: 'restore' })}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restaurar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8 gap-1 text-xs"
                        onClick={() => setConfirmAction({ item, action: 'delete' })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>

      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.action === 'restore' ? 'Restaurar item?' : 'Excluir permanentemente?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === 'restore'
                ? `"${confirmAction?.item.name}" será restaurado e voltará a aparecer normalmente.`
                : `"${confirmAction?.item.name}" será excluído permanentemente. Esta ação NÃO pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction?.action === 'delete' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
              onClick={() => {
                if (!confirmAction) return;
                if (confirmAction.action === 'restore') {
                  handleRestore(confirmAction.item);
                } else {
                  handlePermanentDelete(confirmAction.item);
                }
              }}
            >
              {confirmAction?.action === 'restore' ? 'Restaurar' : 'Excluir definitivamente'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
