import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronDown, Instagram, RefreshCw, Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface InstagramAccount {
  id: string;
  account_name: string;
  instagram_id: string;
  access_token: string;
  profile_picture_url: string | null;
  followers_count: number | null;
  is_active: boolean;
}

interface InstagramAccountSelectorProps {
  selectedAccounts: InstagramAccount[];
  onSelectionChange: (accounts: InstagramAccount[]) => void;
  onAddAccount?: () => void;
}

export const InstagramAccountSelector = ({
  selectedAccounts,
  onSelectionChange,
  onAddAccount,
}: InstagramAccountSelectorProps) => {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('instagram_accounts')
        .select('*')
        .eq('is_active', true)
        .order('account_name', { ascending: true });

      if (error) throw error;
      
      const accountsData = (data || []) as unknown as InstagramAccount[];
      setAccounts(accountsData);
      
      // Auto-select all if none selected yet
      if (selectedAccounts.length === 0 && accountsData.length > 0) {
        onSelectionChange(accountsData);
      }
    } catch (error) {
      console.error('Error fetching Instagram accounts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAccount = (account: InstagramAccount) => {
    const isSelected = selectedAccounts.some(a => a.id === account.id);
    
    if (isSelected) {
      // Don't allow deselecting the last account
      if (selectedAccounts.length === 1) {
        toast.info('Mantenha pelo menos uma conta selecionada');
        return;
      }
      onSelectionChange(selectedAccounts.filter(a => a.id !== account.id));
    } else {
      onSelectionChange([...selectedAccounts, account]);
    }
  };

  const selectAll = () => {
    onSelectionChange(accounts);
  };

  const getDisplayText = () => {
    if (selectedAccounts.length === 0) {
      return 'Selecionar contas';
    }
    if (selectedAccounts.length === 1) {
      return selectedAccounts[0].account_name;
    }
    if (selectedAccounts.length === accounts.length) {
      return 'Todas as contas';
    }
    return `${selectedAccounts.length} contas`;
  };

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Carregando...
      </Button>
    );
  }

  if (accounts.length === 0) {
    return (
      <Button 
        variant="outline" 
        size="sm" 
        className="gap-2"
        onClick={onAddAccount}
      >
        <Plus className="h-4 w-4" />
        Conectar conta Instagram
      </Button>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 min-w-[180px] justify-between">
          <div className="flex items-center gap-2">
            {selectedAccounts.length === 1 ? (
              <Avatar className="h-5 w-5">
                <AvatarImage src={selectedAccounts[0].profile_picture_url || ''} />
                <AvatarFallback className="text-xs">
                  <Instagram className="h-3 w-3" />
                </AvatarFallback>
              </Avatar>
            ) : (
              <Users className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="truncate">{getDisplayText()}</span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Contas Instagram</span>
            <div className="flex items-center gap-1">
              {selectedAccounts.length < accounts.length && (
                <Button variant="ghost" size="sm" onClick={selectAll} className="h-7 text-xs">
                  Selecionar todas
                </Button>
              )}
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={fetchAccounts}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
        
        <ScrollArea className="max-h-[280px]">
          <div className="p-2 space-y-1">
            {accounts.map((account) => {
              const isSelected = selectedAccounts.some(a => a.id === account.id);
              
              return (
                <div
                  key={account.id}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors hover:bg-muted/50 ${
                    isSelected ? 'bg-muted/30' : ''
                  }`}
                  onClick={() => toggleAccount(account)}
                >
                  <Checkbox 
                    checked={isSelected}
                    onCheckedChange={() => toggleAccount(account)}
                    className="pointer-events-none"
                  />
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={account.profile_picture_url || ''} />
                    <AvatarFallback>
                      <Instagram className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {account.account_name}
                    </p>
                    {account.followers_count && (
                      <p className="text-xs text-muted-foreground">
                        {account.followers_count.toLocaleString()} seguidores
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <Badge variant="secondary" className="text-xs">
                      ✓
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {onAddAccount && (
          <div className="p-2 border-t">
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={() => {
                setIsOpen(false);
                onAddAccount();
              }}
            >
              <Plus className="h-4 w-4" />
              Adicionar nova conta
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
