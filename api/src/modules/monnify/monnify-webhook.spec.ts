import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MonnifyService } from './monnify.service';

const SECRET = 'test-secret-key';
const sign = (body: string, secret = SECRET) => createHmac('sha512', secret).update(body).digest('hex');

function build(opts: { mock?: boolean } = {}) {
  const config = {
    get: (k: string) =>
      ({ 'monnify.secretKey': SECRET, 'monnify.apiKey': 'k', 'monnify.contractCode': 'c', 'monnify.mockMode': !!opts.mock })[k],
  };
  return new MonnifyService(config as any, {} as any, {} as any, {} as any, {} as any);
}

// An event type the router ignores, so a trusted/accepted delivery never touches the database.
const body = JSON.stringify({ eventType: 'SOMETHING_ELSE', eventData: {} });

describe('Monnify webhook signature', () => {
  const OLD = process.env.MONNIFY_ENFORCE_WEBHOOK_SIGNATURE;
  afterEach(() => {
    if (OLD === undefined) delete process.env.MONNIFY_ENFORCE_WEBHOOK_SIGNATURE;
    else process.env.MONNIFY_ENFORCE_WEBHOOK_SIGNATURE = OLD;
  });

  it('verifies HMAC-SHA512 of the raw body', () => {
    const svc = build();
    expect(svc.verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, a missing header and a wrong-length header', () => {
    const svc = build();
    expect(svc.verifyWebhookSignature(body + ' ', sign(body))).toBe(false);
    expect(svc.verifyWebhookSignature(body, sign(body, 'other-secret'))).toBe(false);
    expect(svc.verifyWebhookSignature(body, undefined)).toBe(false);
    expect(svc.verifyWebhookSignature(body, 'abc')).toBe(false);
  });

  it('is enforced by default in live mode: unsigned and forged deliveries get 401', async () => {
    delete process.env.MONNIFY_ENFORCE_WEBHOOK_SIGNATURE;
    const svc = build();
    expect(svc.enforceWebhookSignature).toBe(true);
    await expect(svc.processWebhook(body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.processWebhook(body, sign(body, 'wrong'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a correctly signed delivery', async () => {
    const svc = build();
    await expect(svc.processWebhook(body, sign(body))).resolves.toEqual({ received: true });
  });

  it('MONNIFY_ENFORCE_WEBHOOK_SIGNATURE=false is the explicit escape hatch', async () => {
    process.env.MONNIFY_ENFORCE_WEBHOOK_SIGNATURE = 'false';
    const svc = build();
    expect(svc.enforceWebhookSignature).toBe(false);
    await expect(svc.processWebhook(body, undefined)).resolves.toEqual({ received: true });
  });

  it('mock mode (no real credentials) never enforces', () => {
    delete process.env.MONNIFY_ENFORCE_WEBHOOK_SIGNATURE;
    expect(build({ mock: true }).enforceWebhookSignature).toBe(false);
  });

  it('rejects non-JSON bodies with 400 before anything else', async () => {
    await expect(build().processWebhook('not json', sign('not json'))).rejects.toThrow('Invalid JSON payload');
  });
});
