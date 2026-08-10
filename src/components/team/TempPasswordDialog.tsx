import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Copy, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  password: string;
  title?: string;
}

export function TempPasswordDialog({ open, onOpenChange, email, password, title }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copiado');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {title || 'Senha provisória'}
          </DialogTitle>
          <DialogDescription>
            Guarde agora: esta senha <strong>não será exibida novamente</strong>. Envie para a
            pessoa por um canal seguro e peça para trocá-la no primeiro acesso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">E-mail</p>
            <p className="text-sm font-medium break-all">{email}</p>
          </div>
          <div className="rounded-lg border bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Senha provisória</p>
            <p className="text-lg font-mono tracking-wide break-all">{password}</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => copy(`E-mail: ${email}\nSenha: ${password}`)}>
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            Copiar acesso
          </Button>
          <Button onClick={() => copy(password)}>
            <Copy className="h-4 w-4 mr-2" />
            Copiar senha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
