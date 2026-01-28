import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ClipboardPaste, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import { parseLeadMessage, normalizeState, ParsedLeadData } from '@/utils/leadMessageParser';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PasteLeadMessageProps {
  onParsed: (data: ParsedLeadData) => void;
  customFieldNames?: string[];
}

export function PasteLeadMessage({ onParsed, customFieldNames = [] }: PasteLeadMessageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ParsedLeadData | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const handleParse = () => {
    if (!message.trim()) return;
    
    const parsed = parseLeadMessage(message);
    
    // Normalize state abbreviation
    if (parsed.state) {
      parsed.state = normalizeState(parsed.state);
    }
    
    setPreview(parsed);
  };

  const handleApply = () => {
    if (!preview) return;
    onParsed(preview);
    setIsOpen(false);
    setMessage('');
    setPreview(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    setMessage('');
    setPreview(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) handleClose();
      else setIsOpen(true);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <ClipboardPaste className="h-4 w-4" />
          Colar Mensagem
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Importar Lead de Mensagem
          </DialogTitle>
          <DialogDescription>
            Cole uma mensagem estruturada para preencher automaticamente os campos do lead
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          <div>
            <Label>Cole a mensagem estruturada aqui:</Label>
            <Textarea
              placeholder={`Exemplo:
📅 **Data da criação:** 27/01/2026
🔢 **Lead título:** AND335/jan.2026
✅ **STATUS:** OUTBOUND
👤 **Acolhedor:** Andressa
📍 **Cidade da Visita:** Diamantino
🏛 **Estado da Visita:** MT
🆔 **Nome da Vítima:** João Silva
...`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleParse} disabled={!message.trim()} className="gap-2">
              <Wand2 className="h-4 w-4" />
              Processar Mensagem
            </Button>
          </div>

          {preview && (
            <div className="border rounded-lg p-4 bg-muted/50 space-y-4">
              <h4 className="font-semibold text-sm">Campos Extraídos:</h4>
              
              {/* Standard Fields */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Campos Padrão:</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {preview.lead_name && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Nome</Badge>
                      <span className="truncate">{preview.lead_name}</span>
                    </div>
                  )}
                  {preview.state && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Estado</Badge>
                      <span>{preview.state}</span>
                    </div>
                  )}
                  {preview.city && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Cidade</Badge>
                      <span className="truncate">{preview.city}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Fields */}
              {Object.keys(preview.customFields).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">
                    Campos Personalizados ({Object.keys(preview.customFields).length}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(preview.customFields).slice(0, 6).map(([key, value]) => (
                      <Badge key={key} variant="secondary" className="text-xs">
                        {key}
                      </Badge>
                    ))}
                    {Object.keys(preview.customFields).length > 6 && (
                      <Badge variant="secondary" className="text-xs">
                        +{Object.keys(preview.customFields).length - 6} mais
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Notes Preview */}
              <Collapsible open={showDetails} onOpenChange={setShowDetails}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    <span className="text-xs">Ver todos os dados extraídos</span>
                    {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-[200px] mt-2">
                    <pre className="text-xs whitespace-pre-wrap bg-background p-3 rounded border">
                      {preview.notes}
                    </pre>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 pt-4 border-t">
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button onClick={handleApply} disabled={!preview}>
            Aplicar ao Formulário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
