-- Force PostgREST schema cache refresh by touching the table
COMMENT ON COLUMN public.wjia_command_shortcuts.lead_status_board_ids IS 'Array of board IDs for lead status filtering';