import CryptoJS from "npm:crypto-js@4.2.0";

Deno.test("Decrypt SHEIN secretKey with CryptoJS", () => {
  const encryptedHex = "96A8838497BC4CB3A6BDA13EF7081368";
  const appSecret = "16930A372FD64D298C1BB7C3B253ECD3";

  // Try 1: Key = first 16 ASCII chars, parsed as UTF8
  const key1 = CryptoJS.enc.Utf8.parse(appSecret.substring(0, 16));
  const encrypted1 = CryptoJS.enc.Hex.parse(encryptedHex);
  const cipherParams1 = CryptoJS.lib.CipherParams.create({ ciphertext: encrypted1 });

  try {
    const decrypted1 = CryptoJS.AES.decrypt(cipherParams1, key1, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    });
    console.log("Result 1 (UTF8 key, PKCS7):", decrypted1.toString(CryptoJS.enc.Utf8));
  } catch (_e) {
    console.log("Failed 1");
  }

  // Try 2: Key = full appSecret hex-decoded (16 bytes)
  const key2 = CryptoJS.enc.Hex.parse(appSecret);
  try {
    const decrypted2 = CryptoJS.AES.decrypt(cipherParams1, key2, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    });
    console.log("Result 2 (Hex key, PKCS7):", decrypted2.toString(CryptoJS.enc.Utf8));
  } catch (_e) {
    console.log("Failed 2");
  }

  // Try 3: No padding
  try {
    const decrypted3 = CryptoJS.AES.decrypt(cipherParams1, key1, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.NoPadding,
    });
    console.log("Result 3 (UTF8 key, NoPadding) hex:", decrypted3.toString(CryptoJS.enc.Hex));
    console.log("Result 3 (UTF8 key, NoPadding) utf8:", decrypted3.toString(CryptoJS.enc.Utf8));
  } catch (_e) {
    console.log("Failed 3");
  }

  // Try 4: Hex key, no padding
  try {
    const decrypted4 = CryptoJS.AES.decrypt(cipherParams1, key2, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.NoPadding,
    });
    console.log("Result 4 (Hex key, NoPadding) hex:", decrypted4.toString(CryptoJS.enc.Hex));
    console.log("Result 4 (Hex key, NoPadding) utf8:", decrypted4.toString(CryptoJS.enc.Utf8));
  } catch (_e) {
    console.log("Failed 4");
  }
});
