/* CryptoChat — AES-256-GCM + PBKDF2(SHA-256, 150k) */
(function (global) {
  'use strict';
  const TE = new TextEncoder();
  const TD = new TextDecoder();

  const toB64   = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const fromB64 = s   => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function sha256(str) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(str)));
  }

  async function deriveKey(secret) {
    const salt = await sha256('cryptochat::v2::salt::' + secret);
    const base = await crypto.subtle.importKey(
      'raw', TE.encode(secret), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(key, obj) {
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const data = TE.encode(JSON.stringify(obj));
    const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const out  = new Uint8Array(iv.length + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), iv.length);
    return toB64(out);
  }

  async function decrypt(key, b64) {
    const raw = fromB64(b64);
    const pt  = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      key,
      raw.slice(12)
    );
    return JSON.parse(TD.decode(pt));
  }

  function pairSecret(a, b) {
    return [a, b].sort().join('::');
  }

  global.CryptoChat = { deriveKey, encrypt, decrypt, pairSecret, toB64, fromB64 };
})(window);
