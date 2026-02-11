import CryptoJS from "crypto-js";

const SHEIN_BASE_URL = "https://openapi.sheincorp.cn";

function generateRandomKey(length = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateSignature(
  appId: string,
  appSecret: string,
  path: string,
  timestamp: string
): string {
  const randomKey = generateRandomKey();
  const message = `${appId}&${timestamp}&${path}`;
  const hmacKey = appSecret + randomKey;
  const hmac = CryptoJS.HmacSHA256(message, hmacKey);
  const hmacBase64 = CryptoJS.enc.Base64.stringify(hmac);
  return randomKey + hmacBase64;
}

export interface SheinAuthCredentials {
  openKeyId: string;
  secretKey: string;
}

export async function callSheinApi(
  path: string,
  credentials: SheinAuthCredentials,
  appId: string,
  appSecret: string,
  body?: Record<string, unknown>
): Promise<any> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = generateSignature(appId, appSecret, path, timestamp);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-lt-appid": appId,
    "x-lt-timestamp": timestamp,
    "x-lt-signature": signature,
    "x-lt-accesstoken": credentials.openKeyId,
  };

  const res = await fetch(`${SHEIN_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return res.json();
}

export const SHEIN_APP_ID = "143DF450858008671635C1AFEEC07";
export const SHEIN_APP_SECRET = "16930A372FD64D298C1BB7C3B253ECD3";
