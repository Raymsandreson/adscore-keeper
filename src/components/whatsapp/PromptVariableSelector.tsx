import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Variable, User, Phone, Briefcase, Users, FileText } from 'lucide-react';

const VARIABLE_CATEGORIES = [
  {
    category: 'Lead',
    icon: User,
    color: 'text-blue-600',
    variables: [
      { key: '{lead.nome}', label: 'Nome do lead' },
      { key: '{lead.telefone}', label: 'Telefone do lead' },
      { key: '{lead.email}', label: 'Email' },
      { key: '{lead.status}', label: 'Status do lead' },
      { key: '{lead.funil}', label: 'Nome do funil' },
      { key: '{lead.etapa}', label: 'Etapa atual' },
      { key: '{lead.acolhedor}', label: 'Acolhedor/Responsável' },
      { key: '{lead.produto}', label: 'Produto/Serviço' },
      { key: '{lead.data_criacao}', label: 'Data de criação' },
      { key: '{lead.observacoes}', label: 'Observações' },
    ],
  },
  {
    category: 'Contato',
    icon: Phone,
    color: 'text-green-600',
    variables: [
      { key: '{contato.nome}', label: 'Nome completo' },
      { key: '{contato.telefone}', label: 'Telefone' },
      { key: '{contato.email}', label: 'Email' },
      { key: '{contato.cpf}', label: 'CPF' },
      { key: '{contato.cidade}', label: 'Cidade' },
      { key: '{contato.estado}', label: 'Estado' },
      { key: '{contato.profissao}', label: 'Profissão' },
      { key: '{contato.classificacao}', label: 'Classificação' },
      { key: '{contato.data_nascimento}', label: 'Data de nascimento' },
    ],
  },
  {
    category: 'Processo',
    icon: Briefcase,
    color: 'text-purple-600',
    variables: [
      { key: '{processo.numero}', label: 'Nº do processo' },
      { key: '{processo.caso}', label: 'Nº do caso' },
      { key: '{processo.tipo}', label: 'Tipo do caso' },
      { key: '{processo.status}', label: 'Status do processo' },
      { key: '{processo.nucleo}', label: 'Núcleo' },
      { key: '{processo.tribunal}', label: 'Tribunal' },
    ],
  },
  {
    category: 'Grupo',
    icon: Users,
    color: 'text-orange-600',
    variables: [
      { key: '{grupo.nome}', label: 'Nome do grupo' },
      { key: '{grupo.link_convite}', label: 'Link de convite do grupo' },
    ],
  },
  {
    category: 'Campos Personalizados',
    icon: FileText,
    color: 'text-pink-600',
    variables: [
      { key: '{campo.NOME_DO_CAMPO}', label: 'Qualquer campo personalizado' },
    ],
  },
];

interface Props {
  onInsert: (variable: string) => void;
}

export function PromptVariableSelector({ onInsert }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1">
          <Variable className="h-3 w-3" />
          Inserir campo
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[400px] overflow-y-auto p-2" align="end">
        <p className="text-xs font-medium mb-2 px-1">Clique para inserir no prompt</p>
        {VARIABLE_CATEGORIES.map(cat => (
          <div key={cat.category} className="mb-3">
            <div className="flex items-center gap-1.5 mb-1 px-1">
              <cat.icon className={`h-3.5 w-3.5 ${cat.color}`} />
              <span className="text-xs font-medium">{cat.category}</span>
            </div>
            <div className="flex flex-wrap gap-1 px-1">
              {cat.variables.map(v => (
                <Badge
                  key={v.key}
                  variant="outline"
                  className="text-[10px] cursor-pointer hover:bg-primary/10 transition-colors"
                  onClick={() => { onInsert(v.key); setOpen(false); }}
                  title={v.label}
                >
                  {v.key}
                </Badge>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground px-1 mt-2 border-t pt-2">
          Para campos personalizados, use <code className="bg-muted px-1 rounded">{'{campo.nome_do_campo}'}</code> com o nome exato do campo criado no lead.
        </p>
      </PopoverContent>
    </Popover>
  );
}
