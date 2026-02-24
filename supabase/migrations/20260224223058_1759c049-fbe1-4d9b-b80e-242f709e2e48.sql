
CREATE OR REPLACE FUNCTION public.notify_workflow_change(
  p_board_id UUID,
  p_board_name TEXT,
  p_changed_by UUID,
  p_change_description TEXT DEFAULT 'O fluxo de trabalho foi atualizado.'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_user_name TEXT;
BEGIN
  -- Find all distinct users who have leads assigned in this board
  -- and who are NOT the person who made the change
  FOR v_user_id IN
    SELECT DISTINCT l.assigned_to
    FROM leads l
    WHERE l.board_id = p_board_id
      AND l.assigned_to IS NOT NULL
      AND l.assigned_to != p_changed_by
  LOOP
    -- Also find users who have lead_processes linked to this workflow
    -- (already covered if they have leads, but let's be thorough)
    
    SELECT full_name INTO v_user_name
    FROM profiles
    WHERE user_id = v_user_id
    LIMIT 1;

    INSERT INTO lead_activities (
      title,
      description,
      activity_type,
      status,
      priority,
      assigned_to,
      assigned_to_name,
      created_by,
      deadline
    ) VALUES (
      'Atualização no fluxo: ' || p_board_name,
      p_change_description,
      'notificacao',
      'pendente',
      'normal',
      v_user_id,
      v_user_name,
      p_changed_by,
      CURRENT_DATE
    );
  END LOOP;

  -- Also notify users who have lead_processes using this workflow but aren't lead assignees
  FOR v_user_id IN
    SELECT DISTINCT l.assigned_to
    FROM lead_processes lp
    JOIN leads l ON l.id = lp.lead_id
    WHERE lp.workflow_id = p_board_id::text
      AND l.assigned_to IS NOT NULL
      AND l.assigned_to != p_changed_by
      AND l.assigned_to NOT IN (
        SELECT DISTINCT l2.assigned_to
        FROM leads l2
        WHERE l2.board_id = p_board_id
          AND l2.assigned_to IS NOT NULL
      )
  LOOP
    SELECT full_name INTO v_user_name
    FROM profiles
    WHERE user_id = v_user_id
    LIMIT 1;

    INSERT INTO lead_activities (
      title,
      description,
      activity_type,
      status,
      priority,
      assigned_to,
      assigned_to_name,
      created_by,
      deadline
    ) VALUES (
      'Atualização no fluxo: ' || p_board_name,
      p_change_description,
      'notificacao',
      'pendente',
      'normal',
      v_user_id,
      v_user_name,
      p_changed_by,
      CURRENT_DATE
    );
  END LOOP;
END;
$$;
