import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
  sublabel?: string;
  previewAmount?: number;
}

interface MultiSelectFilterProps {
  icon?: React.ReactNode;
  placeholder: string;
  allLabel: string;
  options: FilterOption[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  formatCurrency?: (value: number) => string;
  className?: string;
}

export function MultiSelectFilter({
  icon,
  placeholder,
  allLabel,
  options,
  selectedValues,
  onSelectionChange,
  formatCurrency,
  className
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);

  const isAllSelected = selectedValues.length === 0 || selectedValues.includes('all');
  
  const handleSelectAll = () => {
    onSelectionChange(['all']);
  };

  const handleToggleOption = (value: string) => {
    if (value === 'all') {
      handleSelectAll();
      return;
    }

    let newValues: string[];
    
    if (isAllSelected) {
      // If "all" was selected, start with just this option
      newValues = [value];
    } else if (selectedValues.includes(value)) {
      // Remove the value
      newValues = selectedValues.filter(v => v !== value);
      // If nothing selected, go back to "all"
      if (newValues.length === 0) {
        newValues = ['all'];
      }
    } else {
      // Add the value
      newValues = [...selectedValues.filter(v => v !== 'all'), value];
    }
    
    onSelectionChange(newValues);
  };

  const isOptionSelected = (value: string) => {
    if (value === 'all') return isAllSelected;
    return !isAllSelected && selectedValues.includes(value);
  };

  const getDisplayText = () => {
    if (isAllSelected) return allLabel;
    if (selectedValues.length === 1) {
      const option = options.find(o => o.value === selectedValues[0]);
      return option?.label || selectedValues[0];
    }
    return `${selectedValues.length} selecionados`;
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectionChange(['all']);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 rounded-xl justify-between font-normal",
            !isAllSelected && "border-primary/50",
            className
          )}
        >
          <div className="flex items-center gap-2 truncate">
            {icon}
            <span className="truncate">{getDisplayText()}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!isAllSelected && (
              <Badge 
                variant="secondary" 
                className="h-5 px-1.5 text-xs rounded-full"
                onClick={clearSelection}
              >
                {selectedValues.length}
                <X className="h-3 w-3 ml-1" />
              </Badge>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          <div className="p-2">
            {/* Select All Option */}
            <div
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                isAllSelected ? "bg-primary/10" : "hover:bg-muted"
              )}
              onClick={() => handleSelectAll()}
            >
              <Checkbox 
                checked={isAllSelected}
                className="pointer-events-none"
              />
              <span className="font-medium">{allLabel}</span>
            </div>
            
            <div className="h-px bg-border my-2" />
            
            {/* Options */}
            {options.map((option) => (
              <div
                key={option.value}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                  isOptionSelected(option.value) ? "bg-primary/10" : "hover:bg-muted"
                )}
                onClick={() => handleToggleOption(option.value)}
              >
                <Checkbox 
                  checked={isOptionSelected(option.value)}
                  className="pointer-events-none"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{option.label}</span>
                    {option.previewAmount !== undefined && option.previewAmount > 0 && formatCurrency && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatCurrency(option.previewAmount)}
                      </span>
                    )}
                  </div>
                  {option.sublabel && (
                    <span className="text-xs text-muted-foreground">{option.sublabel}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
