import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHEIN_BASE_URL = "https://openapi.sheincorp.com";

function generateRandomKey(length = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => chars[b % chars.length]).join("");
}

async function hmacSha256(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function generateSignature(appId: string, appSecret: string, path: string, timestamp: string) {
  const randomKey = generateRandomKey();
  const message = `${appId}&${timestamp}&${path}`;
  const hmacBase64 = await hmacSha256(message, appSecret + randomKey);
  return { signature: randomKey + hmacBase64 };
}

async function callSheinApi(
  path: string,
  appId: string,
  appSecret: string,
  accessToken: string | null,
  fixieUrl: string,
  body?: Record<string, unknown>
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const { signature } = await generateSignature(appId, appSecret, path, timestamp);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-lt-appid": appId,
    "x-lt-timestamp": timestamp,
    "x-lt-signature": signature,
  };
  if (accessToken) headers["x-lt-accesstoken"] = accessToken;

  if (fixieUrl) {
    try {
      const proxyUrlObj = new URL(fixieUrl);
      const proxyAuth = btoa(`${proxyUrlObj.username}:${proxyUrlObj.password}`);
      headers["Proxy-Authorization"] = `Basic ${proxyAuth}`;
      headers["Proxy-Connection"] = "Keep-Alive";
    } catch (_) {}
  }

  const res = await fetch(`${SHEIN_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const appId = Deno.env.get("SHEIN_APP_ID") ?? "";
  const appSecret = Deno.env.get("SHEIN_APP_SECRET") ?? "";
  const fixieUrl = Deno.env.get("FIXIE_URL") ?? "";

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
      const { data: authData } = await supabase
        .from("shein_auth").select("*").limit(1).maybeSingle();

      if (!authData?.access_token) {
        return new Response(JSON.stringify({ error: "Configura las credenciales primero en el modal." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let productsCount = 0;
      let ordersCount = 0;
      const diagnostics: Record<string, unknown> = {
        fixie_url_set: !!fixieUrl,
        app_id_set: !!appId,
        app_secret_set: !!appSecret,
      };

      try {
        const productsData = await callSheinApi(
          "/open-api/product/query", appId, appSecret,
          authData.access_token, fixieUrl,
          { pageNo: 1, pageSize: 100 }
        );
        diagnostics.products_response = productsData;
        if (productsData.code === "0" && productsData.data?.list) {
          for (const p of productsData.data.list) {
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

      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const ordersData = await callSheinApi(
          "/open-api/order/query", appId, appSecret,
          authData.access_token, fixieUrl,
          {
            startTime: thirtyDaysAgo.toISOString(),
            endTime: new Date().toISOString(),
            pageNo: 1, pageSize: 200,
          }
        );
        diagnostics.orders_response = ordersData;
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

    return new Response(JSON.stringify({ error: "Acción desconocida. Usa: manual-auth, sync" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      error: err.message,
      fixie_url_set: !!fixieUrl,
      app_id_set: !!appId,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
