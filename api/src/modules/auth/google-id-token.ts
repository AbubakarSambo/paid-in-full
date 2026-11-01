import { Logger, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, createVerify, JsonWebKey } from 'crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  /** True when the signature could not be checked (dev only, offline). */
  unverifiedSignature?: boolean;
}

interface Jwk extends JsonWebKey {
  kid: string;
}

const logger = new Logger('GoogleIdToken');
let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

function b64urlJson(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function getKeys(): Promise<Jwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Google certs HTTP ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] ?? 3600);
  jwksCache = { keys: body.keys, expiresAt: Date.now() + maxAge * 1000 };
  return body.keys;
}

/**
 * Verifies a Google Identity Services ID token (RS256 JWT) against Google's public JWKS, without
 * the google-auth-library dependency. Checks signature, iss, aud (= GOOGLE_CLIENT_ID) and exp.
 *
 * Dev offline fallback: when NODE_ENV=development and Google's certs can't be fetched, the claims
 * (iss/aud/exp) are still checked but the signature is NOT, and a warning is logged. Never in
 * production.
 */
export async function verifyGoogleIdToken(idToken: string, clientId: string | undefined): Promise<GoogleIdentity> {
  if (!clientId) throw new UnauthorizedException('Google sign-in is not configured on this server.');
  const parts = (idToken || '').split('.');
  if (parts.length !== 3) throw new UnauthorizedException('Google sign-in failed: invalid token. Please try again.');

  let header: { kid?: string; alg?: string };
  let claims: Record<string, any>;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new UnauthorizedException('Google sign-in failed: invalid token. Please try again.');
  }

  let unverifiedSignature = false;
  try {
    const keys = await getKeys();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk || header.alg !== 'RS256') throw new UnauthorizedException('Google sign-in failed: unknown signing key.');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new UnauthorizedException('Google sign-in failed: signature check failed.');
  } catch (error) {
    if (error instanceof UnauthorizedException) throw error;
    if (process.env.NODE_ENV === 'development') {
      logger.warn(`Could not reach Google certs (${(error as Error).message}); accepting ID token WITHOUT signature check (development only).`);
      unverifiedSignature = true;
    } else {
      throw new UnauthorizedException("We couldn't reach Google to verify your sign-in. Check your connection and try again.");
    }
  }

  if (!ISSUERS.includes(claims.iss)) throw new UnauthorizedException('Google sign-in failed: wrong issuer.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new UnauthorizedException('Google sign-in failed: token was issued for a different app.');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) {
    throw new UnauthorizedException('Your Google sign-in expired. Please try again.');
  }
  if (!claims.email) throw new UnauthorizedException('Your Google account did not share an email address.');

  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name,
    givenName: claims.given_name,
    familyName: claims.family_name,
    picture: claims.picture,
    unverifiedSignature,
  };
}

/** Gmail ignores dots and +tags in the local part; googlemail.com == gmail.com. */
export function normalizeGmail(email: string): string | null {
  const [local, domain] = email.toLowerCase().split('@');
  if (!local || !domain || !['gmail.com', 'googlemail.com'].includes(domain)) return null;
  return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
}
