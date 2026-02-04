import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Link2,
  Search,
  Plus,
  User,
  Loader2,
  Unlink,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Lead {
  id: string;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  status: string | null;
  source: string | null;
}

interface LinkLeadToPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLeadId: string | null;
  postUrl: string;
  onLink: (leadId: string | null) => void;
}

export function LinkLeadToPostDialog({
  open,
  onOpenChange,
  currentLeadId,
  postUrl,
  onLink,
}: LinkLeadToPostDialogProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(currentLeadId);
  const [isCreating, setIsCreating] = useState(false);

  // New lead form
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');

  useEffect(() => {
    if (open) {
      fetchLeads();
      setSelectedLeadId(currentLeadId);
    }
  }, [open, currentLeadId]);

  const fetchLeads = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_name, lead_email, lead_phone, status, source')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLeads(data || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateLead = async () => {
    if (!newLeadName.trim()) {
      toast.error('Nome do lead é obrigatório');
      return;
    }

    setIsCreating(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .insert({
          lead_name: newLeadName.trim(),
          lead_phone: newLeadPhone.trim() || null,
          lead_email: newLeadEmail.trim() || null,
          source: 'external_post',
          news_link: postUrl,
        })
        .select('id')
        .single();

      if (error) throw error;

      toast.success('Lead criado e vinculado!');
      onLink(data.id);
      handleClose();
    } catch (error) {
      console.error('Error creating lead:', error);
      toast.error('Erro ao criar lead');
    } finally {
      setIsCreating(false);
    }
  };

  const handleLink = () => {
    onLink(selectedLeadId);
    handleClose();
  };

  const handleUnlink = () => {
    onLink(null);
    handleClose();
  };

  const handleClose = () => {
    setSearchTerm('');
    setNewLeadName('');
    setNewLeadPhone('');
    setNewLeadEmail('');
    onOpenChange(false);
  };

  const filteredLeads = leads.filter(lead => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      lead.lead_name?.toLowerCase().includes(search) ||
      lead.lead_email?.toLowerCase().includes(search) ||
      lead.lead_phone?.toLowerCase().includes(search)
    );
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Vincular a Lead
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="existing" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="existing">Lead Existente</TabsTrigger>
            <TabsTrigger value="new">Criar Novo Lead</TabsTrigger>
          </TabsList>

          <TabsContent value="existing" className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar lead..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {filteredLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedLeadId === lead.id
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedLeadId(lead.id)}
                    >
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{lead.lead_name || 'Sem nome'}</span>
                        {lead.source && (
                          <Badge variant="outline" className="text-xs">
                            {lead.source}
                          </Badge>
                        )}
                      </div>
                      {(lead.lead_email || lead.lead_phone) && (
                        <div className="text-xs text-muted-foreground mt-1 ml-6">
                          {lead.lead_email && <span>{lead.lead_email}</span>}
                          {lead.lead_email && lead.lead_phone && <span> • </span>}
                          {lead.lead_phone && <span>{lead.lead_phone}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredLeads.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      Nenhum lead encontrado
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              {currentLeadId && (
                <Button variant="outline" onClick={handleUnlink} className="w-full sm:w-auto">
                  <Unlink className="h-4 w-4 mr-2" />
                  Desvincular
                </Button>
              )}
              <div className="flex gap-2 w-full sm:w-auto">
                <Button variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button onClick={handleLink} disabled={!selectedLeadId}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Vincular
                </Button>
              </div>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="new" className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="leadName">Nome *</Label>
                <Input
                  id="leadName"
                  placeholder="Nome do lead"
                  value={newLeadName}
                  onChange={(e) => setNewLeadName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="leadPhone">Telefone</Label>
                <Input
                  id="leadPhone"
                  placeholder="(00) 00000-0000"
                  value={newLeadPhone}
                  onChange={(e) => setNewLeadPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="leadEmail">E-mail</Label>
                <Input
                  id="leadEmail"
                  type="email"
                  placeholder="email@exemplo.com"
                  value={newLeadEmail}
                  onChange={(e) => setNewLeadEmail(e.target.value)}
                />
              </div>

              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ExternalLink className="h-4 w-4" />
                  Post de origem será vinculado automaticamente
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button onClick={handleCreateLead} disabled={!newLeadName.trim() || isCreating}>
                {isCreating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Criar e Vincular
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
