// Stateless session tokens signed with HMAC-SHA256 (Web Crypto, so it runs in both
// the proxy and server actions). The signing key is derived from AUTH_USERNAME and
// AUTH_PASSWORD, so changing either credential invalidates every existing session.

export const SESSION_COOKIE = "tp_session";
export const SESSION_MAX_AGE = 8 * 60 * 60; // seconds

const encoder = new TextEncoder();

function credentials() {
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) return null;
  return { username, password };
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`tp-session\0${creds.username}\0${creds.password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Compares two strings without leaking where they differ (both are hashed first). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return constantTimeEqual(new Uint8Array(ha), new Uint8Array(hb));
}

/** Returns true only when both values match the configured AUTH_USERNAME / AUTH_PASSWORD. */
export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const creds = credentials();
  if (!creds) {
    console.error("AUTH_USERNAME and AUTH_PASSWORD must be set in .env");
    return false;
  }
  // Evaluate both comparisons so timing does not reveal which one failed.
  const [userOk, passOk] = await Promise.all([
    safeEqual(username, creds.username),
    safeEqual(password, creds.password),
  ]);
  return userOk && passOk;
}

export async function createSessionToken(): Promise<string> {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE);
  const signature = await sign(expires);
  if (!signature) throw new Error("AUTH_USERNAME and AUTH_PASSWORD must be set in .env");
  return `${expires}.${signature}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now() / 1000) return false;
  const expected = await sign(expires);
  if (!expected) return false;
  return constantTimeEqual(encoder.encode(signature), encoder.encode(expected));
}
