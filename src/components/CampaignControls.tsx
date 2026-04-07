import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  MoreHorizontal, 
  Pause, 
  Play, 
  DollarSign, 
  Copy, 
  TrendingUp,
  Loader2,
  MapPin
} from "lucide-react";
import { useCampaignManager } from "@/hooks/useCampaignManager";
import { GeoTargetingDialog } from "./GeoTargetingDialog";

interface CampaignControlsProps {
  entityId: string;
  entityType: 'campaign' | 'adset' | 'ad';
  entityName: string;
  currentStatus?: 'ACTIVE' | 'PAUSED';
  currentBudget?: number;
  onActionComplete?: () => void;
}

export const CampaignControls = ({
  entityId,
  entityType,
  entityName,
  currentStatus = 'ACTIVE',
  currentBudget,
  onActionComplete,
}: CampaignControlsProps) => {
  const { isLoading, updateStatus, updateBudget, updateBid, duplicate } = useCampaignManager();
  
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [bidDialogOpen, setBidDialogOpen] = useState(false);
  const [geoDialogOpen, setGeoDialogOpen] = useState(false);
  const [newBudget, setNewBudget] = useState(currentBudget?.toString() || '');
  const [newBid, setNewBid] = useState('');

  const handleToggleStatus = async () => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const result = await updateStatus(entityId, entityType, newStatus);
    if (result.success) {
      onActionComplete?.();
    }
  };

  const handleUpdateBudget = async () => {
    const budget = parseFloat(newBudget);
    if (isNaN(budget) || budget <= 0) return;
    
    const result = await updateBudget(entityId, entityType as 'campaign' | 'adset', budget);
    if (result.success) {
      setBudgetDialogOpen(false);
      onActionComplete?.();
    }
  };

  const handleUpdateBid = async () => {
    const bid = parseFloat(newBid);
    if (isNaN(bid) || bid <= 0) return;
    
    const result = await updateBid(entityId, bid);
    if (result.success) {
      setBidDialogOpen(false);
      onActionComplete?.();
    }
  };

  const handleDuplicate = async () => {
    const result = await duplicate(entityId, entityType);
    if (result.success) {
      onActionComplete?.();
    }
  };

  const entityLabel = entityType === 'campaign' ? 'Campanha' : entityType === 'adset' ? 'Conjunto' : 'Anúncio';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={handleToggleStatus}>
            {currentStatus === 'ACTIVE' ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Pausar {entityLabel}
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Ativar {entityLabel}
              </>
            )}
          </DropdownMenuItem>
          
          {(entityType === 'campaign' || entityType === 'adset') && (
            <>
              <DropdownMenuItem onClick={() => setBudgetDialogOpen(true)}>
                <DollarSign className="h-4 w-4 mr-2" />
                Alterar Orçamento
              </DropdownMenuItem>
              {entityType === 'campaign' && (
                <DropdownMenuItem onClick={() => setGeoDialogOpen(true)}>
                  <MapPin className="h-4 w-4 mr-2" />
                  Segmentação Geográfica
                </DropdownMenuItem>
              )}
            </>
          )}
          
          {entityType === 'adset' && (
            <DropdownMenuItem onClick={() => setBidDialogOpen(true)}>
              <TrendingUp className="h-4 w-4 mr-2" />
              Alterar Lance
            </DropdownMenuItem>
          )}
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem onClick={handleDuplicate}>
            <Copy className="h-4 w-4 mr-2" />
            Duplicar {entityLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Budget Dialog */}
      <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Orçamento</DialogTitle>
            <DialogDescription>
              Defina o novo orçamento diário para "{entityName}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="budget">Orçamento Diário (R$)</Label>
              <Input
                id="budget"
                type="number"
                step="0.01"
                min="1"
                value={newBudget}
                onChange={(e) => setNewBudget(e.target.value)}
                placeholder="Ex: 50.00"
              />
              <p className="text-xs text-muted-foreground">
                Valor mínimo: R$ 1,00. O novo orçamento será aplicado imediatamente.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBudgetDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateBudget} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bid Dialog */}
      <Dialog open={bidDialogOpen} onOpenChange={setBidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Lance</DialogTitle>
            <DialogDescription>
              Defina o novo valor de lance para "{entityName}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bid">Valor do Lance (R$)</Label>
              <Input
                id="bid"
                type="number"
                step="0.01"
                min="0.01"
                value={newBid}
                onChange={(e) => setNewBid(e.target.value)}
                placeholder="Ex: 2.50"
              />
              <p className="text-xs text-muted-foreground">
                O lance é o valor máximo que você está disposto a pagar por resultado.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBidDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateBid} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Geo Targeting Dialog */}
      <GeoTargetingDialog
        open={geoDialogOpen}
        onOpenChange={setGeoDialogOpen}
        entityId={entityId}
        entityName={entityName}
        entityType={entityType}
        onActionComplete={onActionComplete}
      />
    </>
  );
};
