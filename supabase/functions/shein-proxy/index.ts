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
  return { timestamp, signature: `${randomKey}${base64hex}` };
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

  let fetchOptions: RequestInit = {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };

  // Intentar proxy con Deno.createHttpClient
  if (fixieUrl) {
    try {
      const proxyUrlObj = new URL(fixieUrl);
      const proxyBase = `${proxyUrlObj.protocol}//${proxyUrlObj.username}:${proxyUrlObj.password}@${proxyUrlObj.host}`;
      // @ts-ignore
      const client = await Deno.createHttpClient({ proxy: { url: proxyBase } });
      // @ts-ignore
      fetchOptions = { ...fetchOptions, client };
    } catch (_) {}
  }

  const res = await fetch(`${SHEIN_BASE_URL}${path}`, fetchOptions);
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

    if (action === "test-ip") {
      let ip = "unknown";
      let usedProxy = false;
      try {
        const proxyUrlObj = new URL(fixieUrl);
        const proxyBase = `${proxyUrlObj.protocol}//${proxyUrlObj.username}:${proxyUrlObj.password}@${proxyUrlObj.host}`;
        // @ts-ignore
        const client = await Deno.createHttpClient({ proxy: { url: proxyBase } });
        // @ts-ignore
        const res = await fetch("https://api.ipify.org?format=json", { client });
        const data = await res.json();
        ip = data.ip;
        usedProxy = true;
      } catch (e: any) {
        // Si falla el proxy, intenta sin proxy
        try {
          const res = await fetch("https://api.ipify.org?format=json");
          const data = await res.json();
          ip = data.ip + " (SIN PROXY - error: " + e.message + ")";
        } catch (_) {}
      }
      return new Response(JSON.stringify({
        ip_saliente: ip,
        used_proxy: usedProxy,
        es_fixie_1: ip.includes("52.5.155.132"),
        es_fixie_2: ip.includes("52.87.82.133"),
        fixie_url_set: !!fixieUrl,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    return new Response(JSON.stringify({ error: "Acción desconocida. Usa: manual-auth, sync, test-ip" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
