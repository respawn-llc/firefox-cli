export interface WebExtJwtCredentials {
  readonly issuer: string;
  readonly secret: string;
}

export function readWebExtJwtCredentials(env: NodeJS.ProcessEnv): WebExtJwtCredentials {
  return {
    issuer: requireEnv(env, "WEB_EXT_JWT_ISSUER"),
    secret: requireEnv(env, "WEB_EXT_JWT_SECRET"),
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: "WEB_EXT_JWT_ISSUER" | "WEB_EXT_JWT_SECRET"): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${name} for extension signing.`);
  }
  return value;
}
