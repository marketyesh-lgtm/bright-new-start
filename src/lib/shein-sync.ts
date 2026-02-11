import { supabase } from "@/integrations/supabase/client";
import { callSheinApi, SHEIN_APP_ID, SHEIN_APP_SECRET, type SheinAuthCredentials } from "@/lib/shein-api";

export async function getSheinCredentials(): Promise<SheinAuthCredentials | null> {
  const { data } = await supabase
    .from("shein_auth")
    .select("open_key_id, secret_key")
    .limit(1)
    .maybeSingle();

  if (!data?.open_key_id || !data?.secret_key) return null;
  return { openKeyId: data.open_key_id, secretKey: data.secret_key };
}

export async function syncSheinData(): Promise<{ products: number; orders: number }> {
  const creds = await getSheinCredentials();
  if (!creds) throw new Error("No se encontraron credenciales de SHEIN. Configura la autenticación primero.");

  let productCount = 0;
  let orderCount = 0;

  // Sync products/inventory
  try {
    const productsData = await callSheinApi(
      "/open-api/product/query",
      creds,
      SHEIN_APP_ID,
      SHEIN_APP_SECRET,
      { pageNo: 1, pageSize: 100 }
    );

    if (productsData.code === "0" && productsData.data?.list) {
      for (const product of productsData.data.list) {
        await supabase.from("inventory").upsert({
          sku: product.skuCode || product.sku,
          name: product.productName || product.title || "Unknown",
          stock_current: product.stock ?? product.availableStock ?? 0,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "sku" });
        productCount++;
      }
    }
  } catch (e) {
    console.warn("Error syncing products (CORS may block direct calls):", e);
  }

  // Sync orders (last 30 days)
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ordersData = await callSheinApi(
      "/open-api/order/query",
      creds,
      SHEIN_APP_ID,
      SHEIN_APP_SECRET,
      {
        startTime: thirtyDaysAgo.toISOString(),
        endTime: new Date().toISOString(),
        pageNo: 1,
        pageSize: 200,
      }
    );

    if (ordersData.code === "0" && ordersData.data?.list) {
      for (const order of ordersData.data.list) {
        const items = order.orderItems || order.items || [];
        for (const item of items) {
          await supabase.from("sales_history").upsert({
            sku: item.skuCode || item.sku,
            order_id: order.orderNo || order.orderId,
            quantity: item.quantity || 1,
            sale_date: order.orderTime || order.createTime || new Date().toISOString(),
          }, { onConflict: "order_id,sku" });
          orderCount++;
        }
      }
    }
  } catch (e) {
    console.warn("Error syncing orders (CORS may block direct calls):", e);
  }

  return { products: productCount, orders: orderCount };
}
