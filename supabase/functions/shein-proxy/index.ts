import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

async function fetchViaProxy(
  url: string,
  options: RequestInit,
  fixieUrl: string
): Promise<Response> {
  if (!fixieUrl) {
    return fetch(url, options);
  }

  // Parse Fixie proxy URL for CONNECT-style proxy
  const proxyUrl = new URL(fixieUrl);
  const proxyAuth = btoa(`${proxyUrl.username}:${proxyUrl.password}`);

  // Use Proxy-Authorization header approach
  const targetUrl = new URL(url);
  const proxyHeaders = new Headers(options.headers || {});
  proxyHeaders.set("Proxy-Authorization", `Basic ${proxyAuth}`);

  // For HTTPS through HTTP proxy, we route through the proxy
  const proxyFetchUrl = `http://${proxyUrl.host}${targetUrl.pathname}${targetUrl.search}`;

  // Try direct proxy routing first
  try {
    return await fetch(url, {
      ...options,
      headers: proxyHeaders,
    });
  } catch (_e) {
    // Fallback: route through proxy as HTTP
    const httpUrl = url.replace("https://", "http://");
    return await fetch(httpUrl, {
      ...options,
      headers: proxyHeaders,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const fixieUrl = Deno.env.get("FIXIE_URL") ?? "";
    const appId = Deno.env.get("SHEIN_APP_ID")!;
    const appSecret = Deno.env.get("SHEIN_APP_SECRET")!;

    // Set proxy env vars for Deno's built-in proxy support
    if (fixieUrl) {
      Deno.env.set("HTTP_PROXY", fixieUrl);
      Deno.env.set("HTTPS_PROXY", fixieUrl);
    }

    const { path, params, method } = await req.json();

    if (!path) {
      return new Response(
        JSON.stringify({ error: "Missing 'path' in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const { signature } = await generateSignature(appId, appSecret, path, timestamp);

    // Read access credentials from Supabase
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: authData } = await supabase
      .from("shein_auth")
      .select("open_key_id, secret_key, access_token")
      .limit(1)
      .maybeSingle();

    const accessToken = authData?.open_key_id || Deno.env.get("SHEIN_OPEN_KEY_ID") || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-lt-appid": appId,
      "x-lt-timestamp": timestamp,
      "x-lt-signature": signature,
    };
    if (accessToken) {
      headers["x-lt-accesstoken"] = accessToken;
    }

    const targetUrl = `${SHEIN_BASE_URL}${path}`;
    console.log(`[shein-proxy] ${method || "POST"} ${path} via ${fixieUrl ? "Fixie proxy" : "direct"}`);

    const res = await fetch(targetUrl, {
      method: method || "POST",
      headers,
      body: params ? JSON.stringify(params) : undefined,
    });

    const data = await res.json();

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[shein-proxy] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
