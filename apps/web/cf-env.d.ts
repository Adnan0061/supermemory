declare global {
  namespace NodeJS {
    interface ProcessEnv extends CloudflareEnv {
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      AUTH_SECRET: string;
      R2_ENDPOINT: string;
      R2_ACCESS_KEY_ID: string;
      R2_SECRET_ACCESS_KEY: string;
      R2_PUBLIC_BUCKET_ADDRESS: string;
      R2_BUCKET_NAME: string;
      BACKEND_SECURITY_KEY: string;
      BACKEND_BASE_URL: string;
      TELEGRAM_BOT_TOKEN: string;
    }
  }
}

export {};
