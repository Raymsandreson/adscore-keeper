import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  Building2, 
  ChevronDown, 
  Check, 
  RefreshCw,
  Layers
} from "lucide-react";
import { useMultiAccountSelection, SavedAccount } from "@/hooks/useMultiAccountSelection";

interface MultiAccountSelectorProps {
  onSelectionChange?: (selectedAccounts: SavedAccount[]) => void;
  compact?: boolean;
}

const MultiAccountSelector = ({ 
  onSelectionChange,
  compact = false 
}: MultiAccountSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const {
    accounts,
    activeAccounts,
    toggleAccountSelection,
    selectAllAccounts,
    isAccountSelected,
    refreshAccounts,
    selectedCount,
    hasMultipleSelected,
  } = useMultiAccountSelection();

  const handleToggle = (accountId: string) => {
    toggleAccountSelection(accountId);
    if (onSelectionChange) {
      // Need to compute what the new selection would be
      const willBeSelected = !isAccountSelected(accountId);
      let newSelection: SavedAccount[];
      
      if (willBeSelected) {
        newSelection = [...activeAccounts, accounts.find(a => a.id === accountId)!];
      } else {
        newSelection = activeAccounts.filter(a => a.id !== accountId);
      }
      
      onSelectionChange(newSelection);
    }
  };

  const handleSelectAll = () => {
    selectAllAccounts();
    if (onSelectionChange) {
      onSelectionChange(accounts);
    }
  };

  if (accounts.length === 0) {
    return null;
  }

  if (accounts.length === 1) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" />
        <span>{accounts[0].name}</span>
      </div>
    );
  }

  const getTriggerLabel = () => {
    if (selectedCount === 0) return "Selecionar contas";
    if (selectedCount === 1) return activeAccounts[0]?.name || "1 conta";
    if (selectedCount === accounts.length) return "Todas as contas";
    return `${selectedCount} contas`;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size={compact ? "sm" : "default"}
          className="gap-2 min-w-[140px] justify-between"
        >
          <div className="flex items-center gap-2">
            {hasMultipleSelected ? (
              <Layers className="h-4 w-4 text-primary" />
            ) : (
              <Building2 className="h-4 w-4" />
            )}
            <span className="truncate max-w-[120px]">{getTriggerLabel()}</span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Contas Selecionadas</h4>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {selectedCount}/{accounts.length}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => refreshAccounts()}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {hasMultipleSelected && (
            <p className="text-xs text-muted-foreground mt-1">
              Dados serão combinados das contas selecionadas
            </p>
          )}
        </div>
        
        <div className="p-2 max-h-[240px] overflow-y-auto">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
              onClick={() => handleToggle(account.id)}
            >
              <Checkbox
                checked={isAccountSelected(account.id)}
                onCheckedChange={() => handleToggle(account.id)}
                className="pointer-events-none"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{account.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  ID: {account.accountId.replace('act_', '')}
                </p>
              </div>
              {isAccountSelected(account.id) && (
                <Check className="h-4 w-4 text-primary flex-shrink-0" />
              )}
            </div>
          ))}
        </div>

        {accounts.length > 1 && (
          <div className="p-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center gap-2"
              onClick={handleSelectAll}
              disabled={selectedCount === accounts.length}
            >
              <Layers className="h-4 w-4" />
              Selecionar todas
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default MultiAccountSelector;
