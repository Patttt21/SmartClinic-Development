import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function buildOtpAuthUri(params: {
  secret: string;
  accountEmail: string;
  issuer?: string;
}): string {
  const issuer = params.issuer || 'SmartClinic';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.accountEmail)}`;
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateTotpCode(secretBase32: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  tokenInput: string,
  timestampMs = Date.now(),
  windowSteps = 1
): boolean {
  const normalized = tokenInput.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = generateTotpCode(secretBase32, timestampMs + delta * 30_000, 30);
    const a = Buffer.from(candidate);
    const b = Buffer.from(normalized);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

export function generateRecoveryCodes(count = 6): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string, serverSecret: string): string {
  const normalized = code.trim().toUpperCase();
  return crypto
    .createHmac('sha256', serverSecret)
    .update(`recovery:${normalized}`)
    .digest('hex');
}

export function encryptTotpSecret(secretBase32: string, serverSecret: string): string {
  const key = crypto.createHash('sha256').update(serverSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptTotpSecret(envelope: string, serverSecret: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid MFA secret envelope');
  }
  const key = crypto.createHash('sha256').update(serverSecret).digest();
  const iv = Buffer.from(parts[0], 'base64url');
  const tag = Buffer.from(parts[1], 'base64url');
  const ciphertext = Buffer.from(parts[2], 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export interface MfaAssurancePayload {
  uid: string;
  role: string;
  verifiedAtMs: number;
  expiresAtMs: number;
}

export function signMfaAssuranceToken(
  payload: MfaAssurancePayload,
  serverSecret: string
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', serverSecret)
    .update(`aal2:${body}`)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifyMfaAssuranceToken(
  token: string,
  expectedUid: string,
  serverSecret: string,
  nowMs = Date.now()
): MfaAssurancePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', serverSecret)
    .update(`aal2:${body}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MfaAssurancePayload;
    if (parsed.uid !== expectedUid) return null;
    if (parsed.expiresAtMs <= nowMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signAppointmentQrToken(
  params: { appointmentId: string; referenceNumber: string; appointmentDate: string },
  serverSecret: string
): string {
  const nonce = crypto.randomBytes(6).toString('base64url');
  const core = `SC1.${params.appointmentId}.${params.referenceNumber}.${params.appointmentDate}.${nonce}`;
  const sig = crypto
    .createHmac('sha256', serverSecret)
    .update(core)
    .digest('base64url')
    .slice(0, 22);
  return `${core}.${sig}`;
}

export function verifyAppointmentQrTokenSignature(
  qrToken: string,
  serverSecret: string
): { valid: boolean; appointmentId?: string; referenceNumber?: string; appointmentDate?: string } {
  const parts = qrToken.trim().split('.');
  if (parts.length !== 6 || parts[0] !== 'SC1') {
    return { valid: false };
  }
  const [prefix, appointmentId, referenceNumber, appointmentDate, nonce, sig] = parts;
  const core = `${prefix}.${appointmentId}.${referenceNumber}.${appointmentDate}.${nonce}`;
  const expectedSig = crypto
    .createHmac('sha256', serverSecret)
    .update(core)
    .digest('base64url')
    .slice(0, 22);

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false };
  }

  return {
    valid: true,
    appointmentId,
    referenceNumber,
    appointmentDate,
  };
}
