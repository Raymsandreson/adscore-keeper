import { StepTemplatesHub } from '@/components/activities/StepTemplatesHub';
import { useUserFieldTemplates } from '@/hooks/useUserFieldTemplates';

interface StepOption {
  stepId: string;
  stepLabel: string;
  phaseId: string;
  phaseLabel: string | null;
  objectiveLabel: string | null;
  checked: boolean;
}

interface Props {
  fieldKey: string;
  fieldLabel: string;
  currentValue: string;
  onApply: (content: string) => void;
  stepLabel?: string | null;
  phaseLabel?: string | null;
  objectiveLabel?: string | null;
  allSteps?: StepOption[];
  activeStepId?: string | null;
  onSelectStep?: (id: string | null) => void;
}

/**
 * Wrapper que injeta os modelos POR USUÁRIO no StepTemplatesHub.
 * Independe de lead/passo/fluxo — cada usuário só vê os modelos que ele criou
 * para aquele field_key, e o mesmo conjunto aparece em toda atividade.
 */
export function UserFieldTemplatesHub(props: Props) {
  const { variations, persist, canPersist } = useUserFieldTemplates(props.fieldKey);
  return (
    <StepTemplatesHub
      fieldLabel={props.fieldLabel}
      variations={variations}
      currentValue={props.currentValue}
      onApply={props.onApply}
      stepLabel={props.stepLabel || null}
      phaseLabel={props.phaseLabel || null}
      objectiveLabel={props.objectiveLabel || null}
      canPersist={canPersist}
      onPersist={persist}
      allSteps={props.allSteps || []}
      activeStepId={props.activeStepId || null}
      onSelectStep={props.onSelectStep}
    />
  );
}
