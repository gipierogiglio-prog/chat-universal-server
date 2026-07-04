import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BOTS = [
  { username: "hermes_agent", displayName: "Hermes Agent", email: "hermes_agent@bots.local" },
  { username: "dev_bot", displayName: "Dev Bot", email: "dev_bot@bots.local" },
  { username: "writing_bot", displayName: "Writing Bot", email: "writing_bot@bots.local" },
];

async function main() {
  for (const bot of BOTS) {
    const existing = await prisma.user.findUnique({ where: { username: bot.username } });
    if (existing) {
      console.log(`✓ ${bot.username} already exists (id=${existing.id})`);
      continue;
    }

    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const created = await prisma.user.create({
      data: {
        username: bot.username,
        email: bot.email,
        displayName: bot.displayName,
        passwordHash,
        isBot: true,
      },
    });
    console.log(`+ created ${bot.username} (id=${created.id})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
