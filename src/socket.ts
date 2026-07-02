import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "./db.js";
import { verifyToken } from "./middleware/auth.js";
import { createAndDeliverMessage } from "./lib/deliver.js";
import { convRoom, userRoom } from "./lib/io.js";

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
