export interface Config {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  /** smoobu_send_message is only registered when true. */
  allowWrites: boolean;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test(v?.trim() ?? '');

/** Reads and validates the environment. Never includes credential values in errors. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.SMOOBU_API_KEY?.trim();
  const apiSecret = env.SMOOBU_API_SECRET?.trim();
  const missing = [!apiKey && 'SMOOBU_API_KEY', !apiSecret && 'SMOOBU_API_SECRET'].filter(Boolean);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing ${missing.join(' and ')}. This server only supports Smoobu HMAC keys (key + secret, ` +
        'created in Smoobu → Settings → Advanced → API Keys); legacy key-only auth is retired.',
    );
  }
  const baseUrl = env.SMOOBU_BASE_URL?.trim() || undefined;
  if (baseUrl && !/^https:\/\//.test(baseUrl)) {
    throw new ConfigError('SMOOBU_BASE_URL must be an https:// URL.');
  }
  return {
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    baseUrl,
    allowWrites: truthy(env.SMOOBU_ALLOW_WRITES),
  };
}
