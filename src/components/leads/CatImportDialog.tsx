import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { CatLead } from '@/hooks/useCatLeads';

// Column mapping from XLSX headers to DB columns
const COLUMN_MAP: Record<string, keyof CatLead> = {
  'Agente Causador Acidente': 'agente_causador',
  'cbo': 'cbo',
  'CID-10': 'cid_10',
  'CNAE2.0 Empregador': 'cnae_empregador',
  'Filiação Segurado': 'filiacao_segurado',
  'Indica Óbito Acidente': 'indica_obito',
  'Munic Empr': 'municipio_empregador',
  'Natureza da Lesão': 'natureza_lesao',
  'Origem de Cadastramento CAT': 'origem_cadastramento',
  'Parte Corpo Atingida': 'parte_corpo_atingida',
  'Sexo': 'sexo',
  'Tipo do Acidente': 'tipo_acidente',
  'UF Munic. Acidente': 'uf_municipio_acidente',
  'UF Munic. Empregador': 'uf_municipio_empregador',
  'Data Afastamento': 'data_afastamento',
  'Data Acidente': 'data_acidente',
  'Data Nascimento': 'data_nascimento',
  'Data Emissão CAT': 'data_emissao_cat',
  'Tipo de Empregador': 'tipo_empregador',
  'CNPJ/CEI Empregador': 'cnpj_cei_empregador',
  'cpf': 'cpf',
  'nome_completo': 'nome_completo',
  'endereco': 'endereco',
  'bairro': 'bairro',
  'cep': 'cep',
  'municipio': 'municipio',
  'uf': 'uf',
  'celular_1': 'celular_1',
  'resultado_celular_1': 'resultado_celular_1',
  'celular_2': 'celular_2',
  'resultado_celular_2': 'resultado_celular_2',
  'celular_3': 'celular_3',
  'resultado_celular_3': 'resultado_celular_3',
  'celular_4': 'celular_4',
  'resultado_celular_4': 'resultado_celular_4',
  'fixo_1': 'fixo_1',
  'resultado_fixo_1': 'resultado_fixo_1',
  'fixo_2': 'fixo_2',
  'resultado_fixo_2': 'resultado_fixo_2',
  'fixo_3': 'fixo_3',
  'resultado_fixo_3': 'resultado_fixo_3',
  'fixo_4': 'fixo_4',
  'resultado_fixo_4': 'resultado_fixo_4',
};

function parseDate(value: any): string | null {
  if (!value) return null;
  const str = String(value).trim();
  // Try MM/DD/YY format
  const parts = str.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    const year = y.length === 2 ? (parseInt(y) > 50 ? `19${y}` : `20${y}`) : y;
    const date = new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  }
  // Try native parse
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

interface CatImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (leads: Partial<CatLead>[]) => Promise<number>;
}

export function CatImportDialog({ open, onOpenChange, onImport }: CatImportDialogProps) {
  const [preview, setPreview] = useState<Partial<CatLead>[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const mapped: Partial<CatLead>[] = rows
        .filter(row => row['nome_completo']?.toString().trim())
        .map(row => {
          const lead: Record<string, any> = {};
          for (const [xlsCol, dbCol] of Object.entries(COLUMN_MAP)) {
            const val = row[xlsCol];
            if (val === undefined || val === '') continue;

            if (dbCol === 'indica_obito') {
              lead[dbCol] = String(val).toLowerCase() === 'sim';
            } else if (['data_afastamento', 'data_acidente', 'data_nascimento', 'data_emissao_cat'].includes(dbCol)) {
              lead[dbCol] = parseDate(val);
            } else if (dbCol === 'cnpj_cei_empregador') {
              // Keep as string, format CNPJ
              lead[dbCol] = String(val).replace(/[^\\d]/g, '');
            } else {
              lead[dbCol] = String(val).trim();
            }
          }
          return lead as Partial<CatLead>;
        });

      setPreview(mapped);
      if (mapped.length === 0) {
        toast.warning('Nenhum registro válido encontrado na planilha');
      }
    } catch (error) {
      console.error('Error parsing XLSX:', error);
      toast.error('Erro ao ler a planilha');
    }
  };

  const handleImport = async () => {
    if (preview.length === 0) return;
    setImporting(true);
    try {
      const count = await onImport(preview);
      onOpenChange(false);
      setPreview([]);
      setFileName('');
    } catch {
      // error handled in hook
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Planilha CAT
          </DialogTitle>
          <DialogDescription>
            Selecione um arquivo XLSX com os dados das Comunicações de Acidente de Trabalho
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              className="hidden"
            />
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            {fileName ? (
              <div className="space-y-1">
                <p className="font-medium text-sm">{fileName}</p>
                <Badge variant="secondary">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {preview.length} registros encontrados
                </Badge>
              </div>
            ) : (
              <div>
                <p className="font-medium text-sm">Clique para selecionar arquivo</p>
                <p className="text-xs text-muted-foreground mt-1">Suporta .xlsx e .xls</p>
              </div>
            )}
          </div>

          {/* Preview */}
          {preview.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Prévia dos dados ({preview.length} registros)</h4>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">Nome</th>
                      <th className="p-2 text-left">CPF</th>
                      <th className="p-2 text-left">Município/UF</th>
                      <th className="p-2 text-left">Óbito</th>
                      <th className="p-2 text-left">Celular</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 50).map((lead, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 text-muted-foreground">{i + 1}</td>
                        <td className="p-2 font-medium">{lead.nome_completo}</td>
                        <td className="p-2">{lead.cpf}</td>
                        <td className="p-2">{lead.municipio}/{lead.uf}</td>
                        <td className="p-2">
                          {lead.indica_obito ? (
                            <Badge variant="destructive" className="text-[10px]">Sim</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">Não</Badge>
                          )}
                        </td>
                        <td className="p-2">{lead.celular_1 || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 50 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Mostrando 50 de {preview.length} registros
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleImport}
              disabled={preview.length === 0 || importing}
            >
              {importing ? 'Importando...' : `Importar ${preview.length} registros`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
