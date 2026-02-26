import { supabase } from "@/integrations/supabase/client";

export async function syncSheinData(): Promise<{ products: number; orders: number }> {
  // Call shein-proxy to fetch products
  let productCount = 0;
  let orderCount = 0;

  try {
    const { data: productsData, error: pErr } = await supabase.functions.invoke("shein-proxy", {
      body: { path: "/open-api/product/query", params: { pageNo: 1, pageSize: 100 } },
    });
    if (pErr) throw pErr;

    if (productsData?.code === "0" && productsData?.data?.list) {
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
    console.warn("Error syncing products:", e);
  }

  // Fetch orders (last 30 days)
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { data: ordersData, error: oErr } = await supabase.functions.invoke("shein-proxy", {
      body: {
        path: "/open-api/order/query",
        params: {
          startTime: thirtyDaysAgo.toISOString(),
          endTime: new Date().toISOString(),
          pageNo: 1,
          pageSize: 200,
        },
      },
    });
    if (oErr) throw oErr;

    if (ordersData?.code === "0" && ordersData?.data?.list) {
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
    console.warn("Error syncing orders:", e);
  }

  return { products: productCount, orders: orderCount };
}

export async function saveSheinCredentials(openKeyId: string, secretKey: string): Promise<void> {
  const { error } = await supabase.functions.invoke("shein-sync", {
    body: { action: "manual-auth", openKeyId, secretKey },
  });
  if (error) throw new Error(error.message);
}

export async function getSheinCredentials() {
  const { data } = await supabase
    .from("shein_auth")
    .select("open_key_id, secret_key")
    .limit(1)
    .maybeSingle();
  return data;
}
