import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SHEIN_BASE_URL = "https://openapi.sheincorp.com";

function generateRandomKey(length = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (const byte of arr) {
    result += chars[byte % chars.length];
  }
  return result;
}

async function hmacSha256(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function generateSignature(
  appId: string,
  appSecret: string,
  path: string,
  timestamp: string
): Promise<{ signature: string; randomKey: string }> {
  const randomKey = generateRandomKey();
  const message = `${appId}&${timestamp}&${path}`;
  const hmacKey = appSecret + randomKey;
  const hmacBase64 = await hmacSha256(message, hmacKey);
  const signature = randomKey + hmacBase64;
  return { signature, randomKey };
}

async function aes128EcbDecrypt(encryptedBase64: string, keyStr: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(keyStr.substring(0, 16));
  const encryptedBytes = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC", length: 128 },
    false,
    ["decrypt"]
  );
  
  // ECB mode: decrypt each 16-byte block independently using CBC with zero IV
  const blockSize = 16;
  const blocks = Math.ceil(encryptedBytes.length / blockSize);
  let decrypted = new Uint8Array(0);
  
  for (let i = 0; i < blocks; i++) {
    const block = encryptedBytes.slice(i * blockSize, (i + 1) * blockSize);
    const iv = new Uint8Array(16); // zero IV for ECB simulation
    const result = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      cryptoKey,
      block
    );
    const prev = decrypted;
    decrypted = new Uint8Array(prev.length + result.byteLength);
    decrypted.set(prev);
    decrypted.set(new Uint8Array(result), prev.length);
  }
  
  // Remove PKCS7 padding
  const padLen = decrypted[decrypted.length - 1];
  return new TextDecoder().decode(decrypted.slice(0, decrypted.length - padLen));
}

async function callSheinApi(
  path: string,
  appId: string,
  appSecret: string,
  accessToken: string | null,
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
  if (accessToken) {
    headers["x-lt-accesstoken"] = accessToken;
  }

  const res = await fetch(`${SHEIN_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const appId = Deno.env.get("SHEIN_APP_ID")!;
  const appSecret = Deno.env.get("SHEIN_APP_SECRET")!;

  // Route through Fixie proxy for static IP
  const fixieUrl = Deno.env.get("FIXIE_URL") ?? "";
  if (fixieUrl) {
    Deno.env.set("HTTP_PROXY", fixieUrl);
    Deno.env.set("HTTPS_PROXY", fixieUrl);
  }

  try {
    const url = new URL(req.url);
    // Support both query param and body-based action
    let action = url.searchParams.get("action");
    let bodyData: Record<string, unknown> = {};
    
    if (req.method === "POST") {
      try {
        bodyData = await req.json();
        if (bodyData.action) action = bodyData.action as string;
      } catch (_) {
        // No body or invalid JSON
      }
    }

    // Manual auth: store credentials as plain text
    if (action === "manual-auth") {
      const openKeyId = bodyData.openKeyId as string;
      const secretKey = bodyData.secretKey as string;

      if (!openKeyId || !secretKey) {
        return new Response(
          JSON.stringify({ error: "Missing openKeyId or secretKey" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("shein_auth").upsert({
        open_key_id: openKeyId,
        secret_key: secretKey,
        access_token: openKeyId,
      }, { onConflict: "open_key_id" });

      return new Response(
        JSON.stringify({ success: true, message: "Credentials stored" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // OAuth callback: exchange tempToken for secretKey
    if (action === "callback" || url.searchParams.get("tempToken")) {
      const tempToken = url.searchParams.get("tempToken")!;
      const path = "/open-api/auth/get-by-token";
      const data = await callSheinApi(path, appId, appSecret, null, { tempToken });

      if (data.code === "0" && data.data) {
        const encryptedSecret = data.data.secretKey;
        const decryptedSecret = await aes128EcbDecrypt(encryptedSecret, appSecret);

        await supabase.from("shein_auth").upsert({
          open_key_id: data.data.openKeyId,
          secret_key: decryptedSecret,
          access_token: data.data.accessToken,
        }, { onConflict: "open_key_id" });

        return new Response(
          JSON.stringify({ success: true, message: "SHEIN auth configured" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: data }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sync inventory and sales
    if (action === "sync") {
      const { data: authData } = await supabase
        .from("shein_auth")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (!authData?.access_token) {
        return new Response(
          JSON.stringify({ error: "SHEIN not authenticated" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Sync products/stock
      const productsPath = "/open-api/product/query";
      const productsData = await callSheinApi(productsPath, appId, appSecret, authData.access_token, {
        pageNo: 1,
        pageSize: 100,
      });

      if (productsData.code === "0" && productsData.data?.list) {
        for (const product of productsData.data.list) {
          await supabase.from("inventory").upsert({
            sku: product.skuCode || product.sku,
            name: product.productName || product.title || "Unknown",
            stock_current: product.stock ?? product.availableStock ?? 0,
            last_synced_at: new Date().toISOString(),
          }, { onConflict: "sku" });
        }
      }

      // Sync orders (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const ordersPath = "/open-api/order/query";
      const ordersData = await callSheinApi(ordersPath, appId, appSecret, authData.access_token, {
        startTime: thirtyDaysAgo.toISOString(),
        endTime: new Date().toISOString(),
        pageNo: 1,
        pageSize: 200,
      });

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
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: "Sync completed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get dashboard data
    if (action === "dashboard") {
      const { data: inventory } = await supabase.from("inventory").select("*");
      const { data: sales } = await supabase.from("sales_history").select("*");

      return new Response(
        JSON.stringify({ inventory: inventory || [], sales: sales || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use ?action=callback|sync|dashboard" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
