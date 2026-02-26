import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CF_WORKER_URL = "https://shein-proxy.yeshmarketmexico.workers.dev";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const action = body.action;

    if (action === "manual-auth") {
      const { openKeyId, secretKey } = body;
      await supabase.from("shein_auth").upsert({
        open_key_id: openKeyId,
        secret_key: secretKey,
        access_token: openKeyId,
      }, { onConflict: "open_key_id" });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync") {
      let productsCount = 0;
      let ordersCount = 0;
      const diagnostics: Record<string, unknown> = {};

      // Sync productos via Cloudflare Worker
      try {
        const res = await fetch(CF_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "/open-api/openapi-business-backend/product/query",
            params: { pageNum: 1, pageSize: 50 }
          }),
        });
        const productsData = await res.json();
        diagnostics.products_response = productsData;

        if (productsData.code === "0" && productsData.info?.list) {
          for (const p of productsData.info.list) {
            await supabase.from("inventory").upsert({
              sku: p.skuCode || p.sku,
              name: p.productName || p.title || "Sin nombre",
              stock_current: p.stock ?? p.availableStock ?? 0,
              last_synced_at: new Date().toISOString(),
            }, { onConflict: "sku" });
            productsCount++;
          }
        }
      } catch (e: any) {
        diagnostics.products_error = e.message;
      }

      // Sync órdenes via Cloudflare Worker
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const res = await fetch(CF_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "/open-api/order/order-list",
            params: {
              startTime: thirtyDaysAgo.getTime(),
              endTime: Date.now(),
              pageNum: 1,
              pageSize: 200,
            }
          }),
        });
        const ordersData = await res.json();
        diagnostics.orders_response = ordersData;

        if (ordersData.code === "0" && ordersData.info?.list) {
          for (const order of ordersData.info.list) {
            const items = order.orderItems || order.items || [];
            for (const item of items) {
              await supabase.from("sales_history").upsert({
                sku: item.skuCode || item.sku,
                order_id: order.orderNo || order.orderId,
                quantity: item.quantity || 1,
                sale_date: order.orderTime || order.createTime || new Date().toISOString(),
              }, { onConflict: "order_id,sku" });
              ordersCount++;
            }
          }
        }
      } catch (e: any) {
        diagnostics.orders_error = e.message;
      }

      return new Response(JSON.stringify({ success: true, productsCount, ordersCount, diagnostics }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Acción desconocida." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
