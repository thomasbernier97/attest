// Session tokens: "<session_id>.<expires_at>.<signature>", the signature an HMAC-SHA256 of the first
// two parts under SESSION_SIGNING_KEY. The browser sends it on the socket URL and on segment PUTs.

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("SESSION_SIGNING_KEY must be at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function signToken(secret: string, sessionId: string, expiresAt: number): Promise<string> {
  const payload = `${sessionId}.${String(expiresAt)}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

// True when the token is for this session, unexpired and correctly signed.
export async function verifyToken(secret: string, token: string, sessionId: string, now: number): Promise<boolean> {
  const [id, expires, signature, ...rest] = token.split(".");
  if (rest.length > 0 || id !== sessionId || expires === undefined || signature === undefined) return false;
  if (!/^\d+$/.test(expires) || Number(expires) <= now) return false;
  const bytes = fromBase64Url(signature);
  if (bytes === null) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, encoder.encode(`${id}.${expires}`));
}
