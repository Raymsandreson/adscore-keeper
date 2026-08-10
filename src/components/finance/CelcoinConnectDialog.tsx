// Conectar conta bancária por Open Finance (Celcoin).
//
// Ao contrário do widget da Pluggy, aqui o titular precisa ir ao site do banco
// para autenticar e aprovar o compartilhamento — é a exceção de "site de terceiro"
// da regra de não redirecionar. O diálogo deixa isso explícito antes de sair, e
// a rota /openfinance/callback devolve a pessoa exatamente de onde ela saiu.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useCelcoinOpenFinance } from '@/hooks/useCelcoinOpenFinance';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function CelcoinConnectDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { brands, loading, fetchBrands, connect } = useCelcoinOpenFinance();

  const [brandId, setBrandId] = useState('');
  const [cpf, setCpf] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && brands.length === 0) {
      fetchBrands().then((list) => {
        if (list.length === 0) {
          toast.error('Não foi possível carregar a lista de bancos.');
        }
      });
    }
  }, [open, brands.length, fetchBrands]);

  const cpfDigits = useMemo(() => onlyDigits(cpf), [cpf]);
  const cnpjDigits = useMemo(() => onlyDigits(cnpj), [cnpj]);
  const canSubmit = !!brandId && cpfDigits.length === 11 && (cnpjDigits.length === 0 || cnpjDigits.length === 14);

  const handleConnect = async () => {
    if (!user?.id) {
      toast.error('Sessão não identificada.');
      return;
    }
    setSubmitting(true);
    try {
      await connect({
        userId: user.id,
        brandId,
        cpf: cpfDigits,
        cnpj: cnpjDigits || undefined,
        returnTo: window.location.pathname,
      });
      // Não há sucesso a comemorar aqui: connect() troca a página pelo site do banco.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao iniciar a conexão');
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar conta por Open Finance</DialogTitle>
          <DialogDescription>
            Você será levado ao site do banco para autenticar e aprovar o compartilhamento. Ao terminar, volta
            direto para esta tela.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="celcoin-brand">Banco</Label>
            <Select value={brandId} onValueChange={setBrandId} disabled={loading || brands.length === 0}>
              <SelectTrigger id="celcoin-brand">
                <SelectValue placeholder={loading ? 'Carregando bancos…' : 'Selecione o banco'} />
              </SelectTrigger>
              <SelectContent>
                {brands.map((b) => (
                  <SelectItem key={b.brand_id} value={b.brand_id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="celcoin-cpf">CPF de quem vai autorizar</Label>
            <Input
              id="celcoin-cpf"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(formatCpf(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              No Open Finance quem autoriza é sempre uma pessoa física. Para conta da empresa, use o CPF do
              representante legal e informe o CNPJ abaixo.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="celcoin-cnpj">CNPJ da empresa (opcional)</Label>
            <Input
              id="celcoin-cnpj"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              value={cnpj}
              onChange={(e) => setCnpj(formatCnpj(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Preencha para conectar a conta da empresa. Em branco, conecta a conta da pessoa física.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConnect} disabled={!canSubmit || submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Abrindo o banco…
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                Ir para o banco
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
