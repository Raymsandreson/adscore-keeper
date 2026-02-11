import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tag, ChevronDown, Plus, X } from 'lucide-react';
import { classificationColors } from '@/hooks/useContactClassifications';

interface MultiClassificationSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  classifications: { name: string; color: string; label: string; isSystem: boolean }[];
  onAddNew: (name: string, color: string) => Promise<any>;
}

const getLabel = (name: string) => {
  const systemLabels: Record<string, string> = {
    client: 'Cliente',
    non_client: 'Não-Cliente',
    prospect: 'Prospect',
    partner: 'Parceiro',
    supplier: 'Fornecedor',
  };
  return systemLabels[name] || name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export const MultiClassificationSelect: React.FC<MultiClassificationSelectProps> = ({
  values,
  onChange,
  classifications,
  onAddNew,
}) => {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('bg-blue-500');

  const toggleClassification = (name: string) => {
    if (values.includes(name)) {
      onChange(values.filter(v => v !== name));
    } else {
      onChange([...values, name]);
    }
  };

  const handleAddNew = async () => {
    if (!newName.trim()) return;
    const result = await onAddNew(newName, newColor);
    if (result) {
      onChange([...values, result.name]);
      setIsAddingNew(false);
      setNewName('');
    }
  };

  const selectedClassifications = classifications.filter(c => values.includes(c.name));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-[28px] px-2 hover:bg-muted/50 flex flex-wrap gap-1 justify-start"
        >
          {selectedClassifications.length === 0 ? (
            <Badge className="bg-slate-400 text-white text-xs cursor-pointer">
              <Tag className="h-3 w-3" />
              <span className="ml-1">Sem status</span>
              <ChevronDown className="h-3 w-3 ml-1" />
            </Badge>
          ) : (
            <>
              {selectedClassifications.slice(0, 2).map((c) => (
                <Badge key={c.name} className={`${c.color} text-white text-xs`}>
                  {getLabel(c.name)}
                </Badge>
              ))}
              {selectedClassifications.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{selectedClassifications.length - 2}
                </Badge>
              )}
              <ChevronDown className="h-3 w-3 ml-1 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Classificações (múltiplas)</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Classification checkboxes */}
        <div className="p-2 space-y-1 max-h-[250px] overflow-y-auto">
          {classifications.map((option) => (
            <div
              key={option.name}
              className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer"
              onClick={() => toggleClassification(option.name)}
            >
              <Checkbox
                checked={values.includes(option.name)}
                onCheckedChange={() => toggleClassification(option.name)}
              />
              <Badge className={`${option.color} text-white text-xs`}>
                <Tag className="h-3 w-3 mr-1" />
                {getLabel(option.name)}
              </Badge>
            </div>
          ))}
        </div>

        <DropdownMenuSeparator />

        {/* Clear all */}
        {values.length > 0 && (
          <>
            <div
              className="p-2 flex items-center gap-2 cursor-pointer hover:bg-muted/50"
              onClick={() => onChange([])}
            >
              <X className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Limpar classificações</span>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Add new classification */}
        {isAddingNew ? (
          <div className="p-2 space-y-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do status"
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddNew();
                if (e.key === 'Escape') setIsAddingNew(false);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="flex gap-1 flex-wrap">
              {classificationColors.slice(0, 8).map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewColor(c.value);
                  }}
                  className={`w-5 h-5 rounded-full ${c.value} ${newColor === c.value ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                  title={c.label}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={handleAddNew}>
                Criar
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setIsAddingNew(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="p-2 flex items-center gap-2 cursor-pointer hover:bg-muted/50"
            onClick={() => setIsAddingNew(true)}
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm">Novo status...</span>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default MultiClassificationSelect;
