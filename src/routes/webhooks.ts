import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireApiKey } from "../middleware/auth.js";
import {
  createAndDeliverMessage,
  ensureBotUser,
  findOrCreateDirectConversation,
} from "../lib/deliver.js";
import { parseBody } from "../lib/validate.js";

const router = Router();

const webhookSchema = z.object({
  // Email or username of the chat user that should receive the message.
  target_user: z.string().min(1).max(254),
  message: z.string().min(1).max(10000),
  type: z.enum(["text", "notification"]).default("text"),
});

interface Integration {
  path: string;
  apiKey: () => string;
  botUsername: string;
  botDisplayName: string;
  source: string;
}

const integrations: Integration[] = [
  {
    path: "/hermes",
    apiKey: () => config.hermesApiKey,
    botUsername: "hermes_agent",
    botDisplayName: "Hermes Agent",
    source: "hermes",
  },
  {
    path: "/openclaw",
    apiKey: () => config.openclawApiKey,
    botUsername: "openclaw",
    botDisplayName: "OpenClaw",
    source: "openclaw",
  },
];

for (const integration of integrations) {
  router.post(
    integration.path,
    (req, res, next) => requireApiKey(integration.apiKey())(req, res, next),
    async (req, res) => {
      const data = parseBody(webhookSchema, req, res);
      if (!data) return;

      const identifier = data.target_user.toLowerCase();
      const target = await prisma.user.findFirst({
        where: {
          OR: [{ email: identifier }, { username: data.target_user }],
        },
      });
      if (!target) {
        return res.status(404).json({ error: "Target user not found" });
      }

      const bot = await ensureBotUser(
        integration.botUsername,
        integration.botDisplayName
      );
      const { conversation } = await findOrCreateDirectConversation(
        bot.id,
        target.id
      );
      const message = await createAndDeliverMessage({
        conversationId: conversation.id,
        senderId: bot.id,
        type: data.type,
        content: data.message,
        source: integration.source,
      });

      res.status(201).json({
        ok: true,
        message_id: message.id,
        conversation_id: conversation.id,
      });
    }
  );
}

export default router;
