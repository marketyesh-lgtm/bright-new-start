import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHEIN_BASE_URL = "https://openapi.sheincorp.com";

async function generateSignature(
  openKeyId: string,
  secretKey: string,
  path: string
): Promise<{ timestamp: string; signature: string }> {
  const timestamp = String(Date.now());

  const randomBytes = new Uint8Array(4);
  crypto.getRandomValues(randomBytes);
  const randomKey = Array.from(randomBytes)
    .map(b => b.toString(36))
    .join('')
    .substring(0, 5);

  const value = `${openKeyId}&${timestamp}&${path}`;
  const key = `${secretKey}${randomKey}`;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  const bytes = Array.from(new Uint8Array(sig));
  const hex = bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  const base64hex = btoa(hex);
  const finalSignature = `${randomKey}${base64hex}`;

  return { timestamp, signature: finalSignature };
}

async function callSheinApi(
  path: string,
  openKeyId: string,
  secretKey: string,
  fixieUrl: string,
  body?: Record<string, unknown>
) {
  const { timestamp, signature } = await generateSignature(openKeyId, secretKey, path);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-lt-openKeyId": openKeyId,
    "x-lt-timestamp": timestamp,
    "x-lt-signature": signature,
    "language": "en",
  };

  if (fixieUrl) {
    try {
      const proxyUrlObj = new URL(fixieUrl);
      const proxyAuth = btoa(`${proxyUrlObj.username}:${proxyUrlObj.password}`);
      headers["Proxy-Authorization"] = `Basic ${proxyAuth}`;
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

    if (action === "debug") {
      const { data: authData } = await supabase
        .from("shein_auth").select("*").limit(1).maybeSingle();

      const openKeyId = authData?.open_key_id ?? "";
      const secretKey = authData?.secret_key ?? "";
      const path = "/open-api/openapi-business-backend/product/query";

      const timestamp = "1772073111000";
      const randomKey = "abc12";
      const value = `${openKeyId}&${timestamp}&${path}`;
      const key = `${secretKey}${randomKey}`;

      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw", encoder.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false, ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
      const bytes = Array.from(new Uint8Array(sig));
      const hex = bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
      const base64hex = btoa(hex);

      return new Response(JSON.stringify({
        value_signed: value,
        key_used: key.substring(0, 10) + "...",
        hex_full: hex,
        base64hex_full: base64hex,
        final_signature: randomKey + base64hex,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "sync") {
      const { data: authData } = await supabase
        .from("shein_auth").select("*").limit(1).maybeSingle();

      if (!authData?.open_key_id || !authData?.secret_key) {
        return new Response(JSON.stringify({ error: "Configura las credenciales primero en el modal." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const openKeyId = authData.open_key_id;
      const secretKey = authData.secret_key;

      let productsCount = 0;
      let ordersCount = 0;
      const diagnostics: Record<string, unknown> = {
        fixie_url_set: !!fixieUrl,
        open_key_preview: openKeyId?.substring(0, 6) + "...",
        secret_key_preview: secretKey?.substring(0, 4) + "...",
      };

      try {
        const productsData = await callSheinApi(
          "/open-api/openapi-business-backend/product/query",
          openKeyId, secretKey, fixieUrl,
          { pageNum: 1, pageSize: 50 }
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
          "/open-api/openapi-business-backend/order/query",
          openKeyId, secretKey, fixieUrl,
          {
            startTime: thirtyDaysAgo.toISOString(),
            endTime: new Date().toISOString(),
            pageNum: 1, pageSize: 200,
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

    return new Response(JSON.stringify({ error: "Acción desconocida. Usa: manual-auth, sync, debug" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
