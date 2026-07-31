import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { useCampaigns, useEnsureCampaignFromMeta } from '@/hooks/useCampaigns';
import { useMetaCampaignsList } from '@/hooks/useMetaCampaignsList';
import { getMetaCredentials } from '@/utils/metaCredentials';
import { useAuthContext } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

export interface CampaignPickerValue {
  /** campaigns.id do CRM — é o que liga o lead às métricas de ROI/CAC. */
  crmCampaignId: string;
  /** id da campanha no Meta (leads.campaign_id). */
  metaCampaignId: string;
  /** nome da campanha no Meta (leads.campaign_name). */
  metaCampaignName: string;
}

export const EMPTY_CAMPAIGN_VALUE: CampaignPickerValue = {
  crmCampaignId: '', metaCampaignId: '', metaCampaignName: '',
};

interface Props {
  value: CampaignPickerValue;
  onChange: (value: CampaignPickerValue) => void;
  label?: string;
  helpText?: string;
  className?: string;
  /** Dentro de Dialog/Sheet o popover precisa de z-index alto. */
  contentClassName?: string;
}

/**
 * Seletor único de campanha: campanhas do CRM + campanhas vindas da API do Meta.
 *
 * Escolher uma campanha do Meta cria (ou reaproveita) a campanha equivalente no CRM,
 * de modo que o lead já nasce com `crm_campaign_id` preenchido — sem isso o vínculo
 * fica só no texto `campaign_id` e as telas de campanha não enxergam o lead.
 */
export function CampaignPicker({ value, onChange, label = 'Campanha', helpText, className, contentClassName }: Props) {
  const { user } = useAuthContext();
  const { data: crmCampaigns = [], isLoading: loadingCrm } = useCampaigns();
  const { data: metaCampaigns = [], isLoading: loadingMeta, isError: metaError } = useMetaCampaignsList();
  const ensureFromMeta = useEnsureCampaignFromMeta();
  const [linking, setLinking] = useState(false);

  const openCrmCampaigns = useMemo(
    () => crmCampaigns.filter((c) => c.status !== 'closed'),
    [crmCampaigns],
  );

  // Campanhas do Meta que ainda não têm espelho no CRM — as que já têm aparecem
  // uma única vez, no grupo do CRM, para não duplicar a mesma campanha na lista.
  const unlinkedMetaCampaigns = useMemo(() => {
    const linked = new Set(
      crmCampaigns.map((c) => c.meta_campaign_id).filter(Boolean) as string[],
    );
    return metaCampaigns.filter((m) => !linked.has(m.campaign_id));
  }, [crmCampaigns, metaCampaigns]);

  const selectValue = value.crmCampaignId
    ? `crm:${value.crmCampaignId}`
    : value.metaCampaignId
      ? `meta:${value.metaCampaignId}`
      : '__none__';

  const handleChange = async (raw: string) => {
    if (raw === '__none__') {
      onChange(EMPTY_CAMPAIGN_VALUE);
      return;
    }

    if (raw.startsWith('crm:')) {
      const id = raw.slice(4);
      const campaign = crmCampaigns.find((c) => c.id === id);
      onChange({
        crmCampaignId: id,
        metaCampaignId: campaign?.meta_campaign_id || '',
        metaCampaignName: campaign?.meta_campaign_id ? campaign.name : '',
      });
      return;
    }

    const metaId = raw.slice(5);
    const meta = metaCampaigns.find((m) => m.campaign_id === metaId);
    if (!meta) return;

    setLinking(true);
    try {
      const { adAccountId } = await getMetaCredentials();
      const created = await ensureFromMeta.mutateAsync({
        metaCampaignId: meta.campaign_id,
        name: meta.campaign_name,
        metaAdAccountId: adAccountId ? adAccountId.replace(/^act_/, '') : null,
        createdBy: user?.id || null,
      });
      onChange({
        crmCampaignId: created.id,
        metaCampaignId: meta.campaign_id,
        metaCampaignName: meta.campaign_name,
      });
    } catch (e: any) {
      // Sem espelho no CRM o lead ainda guarda a origem no Meta — o vínculo de
      // métricas é que fica pendente, então avisa em vez de engolir o erro.
      console.error('[CampaignPicker] falha ao espelhar campanha do Meta no CRM:', e);
      toast.error(`Campanha marcada, mas não foi possível criá-la no CRM: ${e?.message || 'erro'}`);
      onChange({
        crmCampaignId: '',
        metaCampaignId: meta.campaign_id,
        metaCampaignName: meta.campaign_name,
      });
    } finally {
      setLinking(false);
    }
  };

  const loading = loadingCrm || loadingMeta || linking;

  return (
    <div className={className}>
      <Label className="flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </Label>
      <Select value={selectValue} onValueChange={handleChange} disabled={linking}>
        <SelectTrigger>
          <SelectValue placeholder="Sem campanha" />
        </SelectTrigger>
        <SelectContent className={cn('pointer-events-auto', contentClassName)} position="popper" sideOffset={4}>
          <SelectItem value="__none__">Sem campanha</SelectItem>

          {openCrmCampaigns.length > 0 && (
            <SelectGroup>
              <SelectLabel>Campanhas do CRM</SelectLabel>
              {openCrmCampaigns.map((c) => (
                <SelectItem key={c.id} value={`crm:${c.id}`}>
                  {c.name}{c.meta_campaign_id ? ' · Meta' : ''}
                </SelectItem>
              ))}
            </SelectGroup>
          )}

          {unlinkedMetaCampaigns.length > 0 && (
            <SelectGroup>
              <SelectLabel>Meta Ads</SelectLabel>
              {unlinkedMetaCampaigns.map((m) => (
                <SelectItem key={m.campaign_id} value={`meta:${m.campaign_id}`}>
                  {m.campaign_name}{m.status === 'PAUSED' ? ' (pausada)' : ''}
                </SelectItem>
              ))}
            </SelectGroup>
          )}

          {/* Valor já gravado que não está em nenhuma das listas (campanha antiga
              do Meta, importada com o lead) — sem isso o Select abriria em branco. */}
          {!value.crmCampaignId && value.metaCampaignId
            && !unlinkedMetaCampaigns.some((m) => m.campaign_id === value.metaCampaignId) && (
            <SelectGroup>
              <SelectLabel>Vínculo atual</SelectLabel>
              <SelectItem value={`meta:${value.metaCampaignId}`}>
                {value.metaCampaignName || `Campanha ${value.metaCampaignId}`}
              </SelectItem>
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground mt-1">
        {metaError
          ? 'Não consegui listar as campanhas do Meta (token pode ter expirado — reconecte em Marketing → Anúncios).'
          : helpText || 'Escolher uma campanha do Meta cria o vínculo no CRM e consolida ROI/CAC.'}
      </p>
    </div>
  );
}
