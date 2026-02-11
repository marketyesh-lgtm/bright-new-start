// Test to decrypt the SHEIN secretKey using AES-128-ECB

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function aes128EcbDecryptHex(encryptedHex: string, keyStr: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(keyStr.substring(0, 16));
  const encryptedBytes = hexToUint8Array(encryptedHex);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC", length: 128 },
    false,
    ["decrypt"]
  );
  
  // ECB mode: decrypt each 16-byte block with zero IV
  const blockSize = 16;
  const blocks = Math.ceil(encryptedBytes.length / blockSize);
  let decrypted = new Uint8Array(0);
  
  for (let i = 0; i < blocks; i++) {
    const block = encryptedBytes.slice(i * blockSize, (i + 1) * blockSize);
    const iv = new Uint8Array(16);
    
    // For single-block ECB, we need to add PKCS7 padding to make it a valid CBC input
    // Actually for a single 16-byte block, CBC with zero IV = ECB
    try {
      const result = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv },
        cryptoKey,
        block
      );
      const prev = decrypted;
      decrypted = new Uint8Array(prev.length + result.byteLength);
      decrypted.set(prev);
      decrypted.set(new Uint8Array(result), prev.length);
    } catch (e) {
      // If single block fails (no padding), try with manual padding handling
      console.log("Block decrypt error, trying padded approach:", e.message);
      // The data might not have PKCS7 padding - it's exactly 16 bytes (1 block)
      // For ECB with exactly 1 block and no padding, we need a different approach
      // Try treating the hex as the raw encrypted bytes without padding expectation
      throw e;
    }
  }
  
  // Remove PKCS7 padding if present
  if (decrypted.length > 0) {
    const padLen = decrypted[decrypted.length - 1];
    if (padLen > 0 && padLen <= 16) {
      return new TextDecoder().decode(decrypted.slice(0, decrypted.length - padLen));
    }
  }
  return new TextDecoder().decode(decrypted);
}

Deno.test("Decrypt SHEIN secretKey", async () => {
  const encryptedHex = "96A8838497BC4CB3A6BDA13EF7081368";
  const appSecret = "16930A372FD64D298C1BB7C3B253ECD3";
  
  try {
    const decrypted = await aes128EcbDecryptHex(encryptedHex, appSecret);
    console.log("=== DECRYPTED SECRET KEY ===");
    console.log(decrypted);
    console.log("=== END ===");
    console.log("Length:", decrypted.length);
    console.log("Hex representation:", Array.from(new TextEncoder().encode(decrypted)).map(b => b.toString(16).padStart(2, '0')).join(''));
  } catch (e) {
    console.log("Decryption failed:", e.message);
    
    // Alternative: try with the hex as key too
    console.log("\n--- Trying with hex-decoded key ---");
    const keyBytes = hexToUint8Array(appSecret.substring(0, 32));
    const encBytes = hexToUint8Array(encryptedHex);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CBC", length: 128 },
      false,
      ["decrypt"]
    );
    
    try {
      const iv = new Uint8Array(16);
      const result = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, encBytes);
      const dec = new TextDecoder().decode(result);
      console.log("Decrypted (hex key):", dec);
    } catch (e2) {
      console.log("Also failed with hex key:", e2.message);
      
      // Last try: maybe the value needs to be padded to 32 bytes for CBC
      console.log("\n--- Raw hex values ---");
      console.log("Encrypted bytes:", Array.from(encBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log("Key bytes (text):", Array.from(new TextEncoder().encode(appSecret.substring(0, 16))).map(b => b.toString(16).padStart(2, '0')).join(' '));
      console.log("Key bytes (hex):", Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  }
});
