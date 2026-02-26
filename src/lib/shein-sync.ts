import { supabase } from "@/integrations/supabase/client";

export type SheinAuthCredentials = {
  openKeyId: string;
  secretKey: string;
};

export async function getSheinCredentials(): Promise<SheinAuthCredentials | null> {
  const { data } = await supabase
    .from("shein_auth")
    .select("open_key_id, secret_key")
    .limit(1)
    .maybeSingle();
  if (!data?.open_key_id || !data?.secret_key) return null;
  return { openKeyId: data.open_key_id, secretKey: data.secret_key };
}

export async function saveSheinCredentials(openKeyId: string, secretKey: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("shein-proxy", {
    body: { action: "manual-auth", openKeyId, secretKey },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

export async function syncSheinData(): Promise<{ products: number; orders: number }> {
  const { data, error } = await supabase.functions.invoke("shein-proxy", {
    body: { action: "sync" },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return {
    products: data?.productsCount ?? 0,
    orders: data?.ordersCount ?? 0,
  };
}
