import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-secret-do-not-use-in-prod"),
  jwtExpiresIn: "7d" as const,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  hermesApiKey: process.env.HERMES_API_KEY ?? "",
  hermesWebhookUrl: process.env.HERMES_WEBHOOK_URL ?? "",
  openclawApiKey: process.env.OPENCLAW_API_KEY ?? "",
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadBytes: 20 * 1024 * 1024,
};
