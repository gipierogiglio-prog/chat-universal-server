import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  isBot: true,
  createdAt: true,
} as const;
