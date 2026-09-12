import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function requireEnv(key: keyof NodeJS.ProcessEnv): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable is missing: ${key}`);
  }

  return value;
}

const adapter = new PrismaPg({
  connectionString: requireEnv("DATABASE_URL"),
});

export const prisma = new PrismaClient({ adapter });

prisma.$connect().then(() => {
  return prisma.$executeRaw`SET app.current_platform = 'web'`;
});
