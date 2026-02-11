import CryptoJS from "https://esm.sh/crypto-js@4.2.0";

Deno.test("Decrypt SHEIN secretKey with CryptoJS", () => {
  const encryptedHex = "96A8838497BC4CB3A6BDA13EF7081368";
  const appSecret = "16930A372FD64D298C1BB7C3B253ECD3";

  const key1 = CryptoJS.enc.Utf8.parse(appSecret.substring(0, 16));
  const key2 = CryptoJS.enc.Hex.parse(appSecret);
  const encrypted = CryptoJS.enc.Hex.parse(encryptedHex);
  const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: encrypted });

  // Try all combinations
  for (const [label, key] of [["UTF8-key", key1], ["Hex-key", key2]]) {
    for (const [padLabel, pad] of [["PKCS7", CryptoJS.pad.Pkcs7], ["NoPadding", CryptoJS.pad.NoPadding]]) {
      try {
        const dec = CryptoJS.AES.decrypt(cipherParams, key, { mode: CryptoJS.mode.ECB, padding: pad });
        const hex = dec.toString(CryptoJS.enc.Hex);
        let utf8 = "";
        try { utf8 = dec.toString(CryptoJS.enc.Utf8); } catch (_) { utf8 = "(not valid utf8)"; }
        console.log(`${label} + ${padLabel}: hex=${hex} utf8=${utf8}`);
      } catch (_e) {
        console.log(`${label} + ${padLabel}: FAILED`);
      }
    }
  }
});
