
-- Table for SHEIN auth credentials
CREATE TABLE public.shein_auth (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  open_key_id TEXT,
  secret_key TEXT,
  access_token TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.shein_auth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON public.shein_auth
  FOR ALL USING (auth.role() = 'authenticated');

-- Table for inventory synced from SHEIN
CREATE TABLE public.inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  stock_current INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON public.inventory
  FOR ALL USING (auth.role() = 'authenticated');

-- Table for sales history
CREATE TABLE public.sales_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT NOT NULL,
  order_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  sale_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON public.sales_history
  FOR ALL USING (auth.role() = 'authenticated');

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_shein_auth_updated_at
  BEFORE UPDATE ON public.shein_auth
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
