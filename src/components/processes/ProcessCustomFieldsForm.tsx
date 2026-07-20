interface ProcessCustomFieldsFormProps {
  processId: string;
  workflowId?: string | null;
}

export function ProcessCustomFieldsForm(_props: ProcessCustomFieldsFormProps) {
  return (
    <p className="text-sm text-muted-foreground">
      Nenhum campo customizado configurado.
    </p>
  );
}
