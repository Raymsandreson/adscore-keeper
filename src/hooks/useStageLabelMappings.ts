import { useQuery } from '@tanstack/react-query';
import { cloudFunctions } from '@/lib/functionRouter';

export interface StageLabelMappingInstance {
  instance_name: string;
  label_id: string;
  label_name: string;
  color: number | null;
  result_key: string | null;
}

export interface StageLabelMapping {
  stage_id: string;
  stage_name: string;
  stage_color: string | null;
  result_key: string | null;
  synced: boolean;
  instances: StageLabelMappingInstance[];
}

export interface StageLabelMappingsResponse {
  success: boolean;
  board_id: string;
  board_name?: string;
  stages: StageLabelMapping[];
  error?: string;
}

export function useStageLabelMappings(boardId: string | null | undefined) {
  return useQuery({
    queryKey: ['stage-label-mappings', boardId],
    enabled: !!boardId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await cloudFunctions.invoke<StageLabelMappingsResponse>(
        'list-stage-label-mappings',
        { body: { board_id: boardId } },
      );
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao listar mapeamentos');
      return data;
    },
  });
}
