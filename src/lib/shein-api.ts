// SHEIN API types — all actual API calls go through the shein-proxy edge function

export interface SheinAuthCredentials {
  openKeyId: string;
  secretKey: string;
}

export interface SheinProxyRequest {
  path: string;
  method?: string;
  params?: Record<string, unknown>;
}
