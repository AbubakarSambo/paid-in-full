import { createSign } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Minimal Google Sheets v4 REST client authenticated as a service account (JWT bearer grant), using
 * Node's crypto + global fetch so we don't pull in the heavy `googleapis` package.
 * The service account's email must be given Editor access on the spreadsheet.
 */
export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export class SheetsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TIMEOUT_MS = 20_000;

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function parseServiceAccount(base64: string | undefined | null): ServiceAccountCredentials | null {
  if (!base64 || !base64.trim()) return null;
  try {
    const raw = Buffer.from(base64.trim(), 'base64').toString('utf8');
    const json = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
    if (!json.client_email || !json.private_key) return null;
    return {
      client_email: json.client_email,
      private_key: json.private_key.replace(/\\n/g, '\n'),
      token_uri: json.token_uri,
    };
  } catch {
    return null;
  }
}

/** A1 range for a tab, quoting the tab name ('My Tab'!A1:Q). */
export function a1(tab: string, range: string): string {
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}

export class GoogleSheetsClient {
  private readonly logger = new Logger(GoogleSheetsClient.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly creds: ServiceAccountCredentials) {}

  get serviceAccountEmail() {
    return this.creds.client_email;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const tokenUri = this.creds.token_uri || DEFAULT_TOKEN_URI;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({ iss: this.creds.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = b64url(signer.sign(this.creds.private_key));
    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token) {
      throw new SheetsApiError(`Google auth failed: ${body.error_description || body.error || res.statusText}`, res.status);
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg = json?.error?.message || res.statusText;
      const hint =
        res.status === 403 || res.status === 404
          ? ` (share the sheet with ${this.creds.client_email} as Editor and check the URL)`
          : '';
      throw new SheetsApiError(`Google Sheets API ${res.status}: ${msg}${hint}`, res.status);
    }
    return json as T;
  }

  async tabTitles(spreadsheetId: string): Promise<string[]> {
    const meta = await this.request<{ sheets?: { properties: { title: string } }[] }>(
      'GET',
      `${API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    );
    return (meta.sheets ?? []).map((s) => s.properties.title);
  }

  async ensureTab(spreadsheetId: string, tab: string): Promise<void> {
    const titles = await this.tabTitles(spreadsheetId);
    if (titles.includes(tab)) return;
    this.logger.log(`Creating tab "${tab}" in spreadsheet ${spreadsheetId}`);
    await this.request('POST', `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title: tab } } }],
    });
  }

  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const res = await this.request<{ values?: unknown[][] }>(
      'GET',
      `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
    );
    return (res.values ?? []).map((r) => r.map((c) => (c == null ? '' : String(c))));
  }

  async batchGet(spreadsheetId: string, ranges: string[]): Promise<string[][][]> {
    const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const res = await this.request<{ valueRanges?: { values?: unknown[][] }[] }>(
      'GET',
      `${API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs}`,
    );
    return (res.valueRanges ?? []).map((vr) => (vr.values ?? []).map((r) => r.map((c) => (c == null ? '' : String(c)))));
  }

  async update(spreadsheetId: string, range: string, values: unknown[][]): Promise<void> {
    await this.request(
      'PUT',
      `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { range, majorDimension: 'ROWS', values },
    );
  }

  async batchUpdate(spreadsheetId: string, data: { range: string; values: unknown[][] }[]): Promise<void> {
    if (data.length === 0) return;
    await this.request('POST', `${API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      valueInputOption: 'RAW',
      data,
    });
  }

  async append(spreadsheetId: string, range: string, values: unknown[][]): Promise<void> {
    if (values.length === 0) return;
    await this.request(
      'POST',
      `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { majorDimension: 'ROWS', values },
    );
  }

  async clear(spreadsheetId: string, range: string): Promise<void> {
    await this.request('POST', `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {});
  }
}
