Deno.test("Decrypt SHEIN secretKey", async () => {
  const encryptedHex = "96A8838497BC4CB3A6BDA13EF7081368";
  const appSecret = "16930A372FD64D298C1BB7C3B253ECD3";

  function hexToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  // Key = first 16 ASCII chars of appSecret
  const keyBytes = new TextEncoder().encode(appSecret.substring(0, 16));
  const encryptedBytes = hexToUint8Array(encryptedHex);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-CBC", length: 128 },
    false,
    ["decrypt"]
  );

  const iv = new Uint8Array(16);
  try {
    const result = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      cryptoKey,
      encryptedBytes.buffer as ArrayBuffer
    );
    const decrypted = new TextDecoder().decode(result);
    console.log("DECRYPTED (text key, text encoding):", decrypted);
  } catch (_e) {
    console.log("Failed with text key + text encoding");
  }

  // Try with hex-decoded key
  const keyBytesHex = hexToUint8Array(appSecret.substring(0, 32));
  const cryptoKey2 = await crypto.subtle.importKey(
    "raw",
    keyBytesHex.buffer as ArrayBuffer,
    { name: "AES-CBC", length: 128 },
    false,
    ["decrypt"]
  );

  try {
    const iv2 = new Uint8Array(16);
    const result2 = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: iv2 },
      cryptoKey2,
      encryptedBytes.buffer as ArrayBuffer
    );
    const decrypted2 = new TextDecoder().decode(result2);
    console.log("DECRYPTED (hex key):", decrypted2);
  } catch (_e2) {
    console.log("Failed with hex key too");
  }

  // Print raw info
  console.log("Encrypted bytes:", Array.from(encryptedBytes).join(", "));
  console.log("Key bytes (text):", Array.from(keyBytes).join(", "));
  console.log("Key bytes (hex):", Array.from(keyBytesHex).join(", "));
});
