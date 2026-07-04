import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "./db.js";
import { verifyToken } from "./middleware/auth.js";
import { createAndDeliverMessage } from "./lib/deliver.js";
import { convRoom, userRoom } from "./lib/io.js";
import { config } from "./config.js";
import { startBotTyping } from "./lib/botTyping.js";

const sendSchema = z.object({
  conversationId: z.string().min(1),
  type: z.enum(["text", "image", "file"]).default("text"),
  content: z.string().max(10000).default(""),
  fileUrl: z.string().max(1024).optional(),
  fileName: z.string().max(255).optional(),
  fileSize: z.number().int().nonnegative().optional(),
});

const typingSchema = z.object({ conversationId: z.string().min(1) });

type Ack = (response: { ok: boolean; error?: string; message?: unknown }) => void;

export function setupSocket(io: Server) {
  // Handshake auth: the client passes its JWT in `auth.token`.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const userId = typeof token === "string" ? verifyToken(token) : null;
    if (!userId) return next(new Error("Unauthorized"));
    socket.data.userId = userId;
    next();
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;

    socket.join(userRoom(userId));
    const memberships = await prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    for (const m of memberships) socket.join(convRoom(m.conversationId));

    socket.on("message:send", async (payload, ack?: Ack) => {
      try {
        const parsed = sendSchema.safeParse(payload);
        if (!parsed.success) {
          return ack?.({ ok: false, error: "Invalid payload" });
        }
        const data = parsed.data;
        if (data.type === "text" && !data.content.trim()) {
          return ack?.({ ok: false, error: "Empty message" });
        }
        if (data.type !== "text" && !data.fileUrl) {
          return ack?.({ ok: false, error: "fileUrl required" });
        }

        const member = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: data.conversationId,
              userId,
            },
          },
        });
        if (!member) return ack?.({ ok: false, error: "Not a member" });

        const message = await createAndDeliverMessage({
          ...data,
          senderId: userId,
          source: "chat",
        });
        ack?.({ ok: true, message });

        // ── Forward to external agent if this conversation is with a bot ──
        if (config.hermesWebhookUrl && data.type === "text") {
          forwardToBotWebhook(data.conversationId, userId, data.content).catch(
            (err) => console.error("bot forward failed", err)
          );
        }
      } catch (err) {
        console.error("message:send failed", err);
        ack?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("typing", (payload) => {
      const parsed = typingSchema.safeParse(payload);
      if (!parsed.success) return;
      socket.to(convRoom(parsed.data.conversationId)).emit("typing", {
        conversationId: parsed.data.conversationId,
        userId,
      });
    });
  });
}

// ─── Bot Forwarding ─────────────────────────────────────────────────────

/**
 * Forward a user message to an external bot webhook if the conversation
 * contains a bot member (e.g. hermes_agent).
 *
 * Uses a configurable webhook URL (HERMES_WEBHOOK_URL) so the agent
 * backend can be at a different address than the chat-universal server.
 */
async function forwardToBotWebhook(
  conversationId: string,
  senderId: string,
  content: string,
): Promise<void> {
  const botMember = await prisma.conversationMember.findFirst({
    where: {
      conversationId,
      user: { isBot: true },
    },
    include: { user: { select: { username: true, id: true } } },
  });
  if (!botMember || !config.hermesWebhookUrl || !config.hermesApiKey) return;

  // Get the sender's user info
  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: { username: true, id: true },
  });
  if (!sender) return;

  const payload = {
    user_id: sender.id,
    username: sender.username,
    text: content,
    conversation_id: conversationId,
  };

  // Show "Hermes está digitando…" until the reply arrives via the
  // /api/webhooks/hermes callback (stopBotTyping there), or a safety
  // timeout expires.
  startBotTyping(conversationId, botMember.userId);

  const response = await fetch(config.hermesWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.hermesApiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `bot webhook returned ${response.status}: ${body.slice(0, 200)}`,
    );
  }
}
