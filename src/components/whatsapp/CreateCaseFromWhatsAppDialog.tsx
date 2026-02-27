import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { useLegalCases } from '@/hooks/useLegalCases';
import { Loader2, Scale } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string | null;
  leadName?: string | null;
  contactName?: string | null;
  onCaseCreated?: (caseData: any) => void;
}

export function CreateCaseFromWhatsAppDialog({ open, onOpenChange, leadId, leadName, contactName, onCaseCreated }: Props) {
  const { nuclei, loading: nucleiLoading } = useSpecializedNuclei();
  const { createCase } = useLegalCases();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [nucleusId, setNucleusId] = useState<string>('none');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setTitle(leadName || contactName || '');
      setNucleusId('none');
      setDescription('');
      setNotes('');
    }
  }, [open, leadName, contactName]);

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Informe o título do caso');
      return;
    }
    setSaving(true);
    try {
      const result = await createCase({
        lead_id: leadId || '',
        nucleus_id: nucleusId === 'none' ? null : nucleusId,
        title: title.trim(),
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onCaseCreated?.(result);
      onOpenChange(false);
    } catch {
      // error already toasted by hook
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Criar Caso Jurídico
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Título *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Acidente de trabalho - João" className="mt-1" />
          </div>

          <div>
            <Label>Núcleo Especializado</Label>
            <Select value={nucleusId} onValueChange={setNucleusId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Nenhum (sequência geral)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (sequência geral)</SelectItem>
                {nuclei.filter(n => n.is_active).map(n => (
                  <SelectItem key={n.id} value={n.id}>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: n.color }} />
                      {n.name} ({n.prefix})
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Descrição</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição do problema jurídico..." className="mt-1" rows={3} />
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anotações internas..." className="mt-1" rows={2} />
          </div>

          {leadId && (
            <p className="text-xs text-muted-foreground">
              Vinculado ao lead: <strong>{leadName || leadId}</strong>
            </p>
          )}
          {!leadId && (
            <p className="text-xs text-amber-600">
              Este caso será criado sem vínculo a um lead.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar Caso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
