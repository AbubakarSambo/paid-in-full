import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS, // comma-separated list of allowed origins
  platformOpsEmail: process.env.PLATFORM_OPS_EMAIL,
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'super-secret-key',
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
}));

export const resendConfig = registerAs('resend', () => ({
  apiKey: process.env.RESEND_API_KEY,
  fromEmail: process.env.RESEND_FROM_EMAIL || 'Paid in Full <noreply@paidinfull.app>',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  brandWebsiteUrl: process.env.BRAND_WEBSITE_URL || 'https://www.paidinfull.app',
}));

export const googleConfig = registerAs('google', () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
}));

// Monnify — Nigerian payout/collections rail. Disbursement (batch payouts) and reserved-account
// collections both live on api.monnify.com; sandbox is sandbox.monnify.com. Outbound calls for
// disbursement require the platform's Monnify contract IP to be whitelisted, which Railway does
// not guarantee is static across deploys/restarts — see MONNIFY_RELAY_URL below.
export const monnifyConfig = registerAs('monnify', () => ({
  baseUrl: process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com',
  apiKey: process.env.MONNIFY_API_KEY,
  secretKey: process.env.MONNIFY_SECRET_KEY,
  contractCode: process.env.MONNIFY_CONTRACT_CODE,
  // Encrypts nothing platform-side today (single platform-level credential, not per-workspace),
  // reserved for a future per-workspace sub-wallet credential.
  encryptionKey: process.env.MONNIFY_ENCRYPTION_KEY || 'dev-only-insecure-key-change-me',
  // Bypasses real Monnify calls and simulates a batch settling shortly after disbursement —
  // for developing/demoing the queue -> batch -> approve -> disburse loop without a live contract.
  mockMode: process.env.MONNIFY_MOCK_MODE === 'true',
  // Optional relay (see monnify-relay/) that forwards Monnify calls through a fixed-IP proxy.
  // Leave unset to call Monnify directly from this API process.
  relayUrl: process.env.MONNIFY_RELAY_URL,
  relaySharedSecret: process.env.MONNIFY_RELAY_SHARED_SECRET,
  webhookBaseUrl: process.env.MONNIFY_WEBHOOK_BASE_URL,
}));

export const googleSheetsConfig = registerAs('googleSheets', () => ({
  // Service account JSON key, base64-encoded to survive .env quoting/newlines.
  credentialsBase64: process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64,
}));

export const whatsappConfig = registerAs('whatsapp', () => ({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v21.0',
  webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
  // Deep link used by the in-app "Need help?" WhatsApp button.
  supportPhone: process.env.WHATSAPP_SUPPORT_PHONE,
}));

export const aiConfig = registerAs('ai', () => ({
  // Used for COA auto-tagging and expense-description cleanup on queue items.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
}));

export const pushConfig = registerAs('push', () => ({
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:ops@paidinfull.app',
}));
