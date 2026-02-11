-- Drop existing restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.inventory;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.sales_history;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.shein_auth;

-- Permissive policies for inventory
CREATE POLICY "Authenticated users can select inventory"
  ON public.inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert inventory"
  ON public.inventory FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update inventory"
  ON public.inventory FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete inventory"
  ON public.inventory FOR DELETE TO authenticated USING (true);

-- Permissive policies for sales_history
CREATE POLICY "Authenticated users can select sales"
  ON public.sales_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert sales"
  ON public.sales_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update sales"
  ON public.sales_history FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete sales"
  ON public.sales_history FOR DELETE TO authenticated USING (true);

-- Permissive policies for shein_auth
CREATE POLICY "Authenticated users can select shein_auth"
  ON public.shein_auth FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert shein_auth"
  ON public.shein_auth FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update shein_auth"
  ON public.shein_auth FOR UPDATE TO authenticated USING (true);