-- Update dm_history RLS policies to allow all authenticated users to read all records
-- This is needed because the workflow should show all DM history for the team

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view their own DM history" ON public.dm_history;

-- Create new policy that allows all authenticated users to view all DM history
CREATE POLICY "Authenticated users can view all DM history" 
ON public.dm_history 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Also update INSERT policy to allow any authenticated user
DROP POLICY IF EXISTS "Users can insert their own DM history" ON public.dm_history;

CREATE POLICY "Authenticated users can insert DM history" 
ON public.dm_history 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

-- Update DELETE policy
DROP POLICY IF EXISTS "Users can delete their own DM history" ON public.dm_history;

CREATE POLICY "Authenticated users can delete DM history" 
ON public.dm_history 
FOR DELETE 
USING (auth.uid() IS NOT NULL);

-- Update workflow_reports RLS policies similarly
DROP POLICY IF EXISTS "Users can view their own workflow reports" ON public.workflow_reports;
DROP POLICY IF EXISTS "Users can create their own workflow reports" ON public.workflow_reports;
DROP POLICY IF EXISTS "Users can delete their own workflow reports" ON public.workflow_reports;

CREATE POLICY "Authenticated users can view all workflow reports" 
ON public.workflow_reports 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create workflow reports" 
ON public.workflow_reports 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete workflow reports" 
ON public.workflow_reports 
FOR DELETE 
USING (auth.uid() IS NOT NULL);