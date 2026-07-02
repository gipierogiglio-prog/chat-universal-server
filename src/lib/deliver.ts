import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma, publicUserSelect } from "../db.js";
import { getIo, convRoom, userRoom } from "./io.js";

export const messageInclude = {
  sender: { select: publicUserSelect },
} as const;

interface CreateMessageInput {
  conversationId: string;
  senderId: string | null;
  type?: string;
  content: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  source?: string;
}

// Persists a message, bumps the conversation timestamp and pushes the
// message to every connected member in real time.
export async function createAndDeliverMessage(input: CreateMessageInput) {
  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      senderId: input.senderId,
      type: input.type ?? "text",
      content: input.content,
      fileUrl: input.fileUrl ?? null,
      fileName: input.fileName ?? null,
      fileSize: input.fileSize ?? null,
      source: input.source ?? "chat",
    },
    include: messageInclude,
  });

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date() },
  });

  getIo().to(convRoom(input.conversationId)).emit("message:new", message);
  return message;
}

export const conversationInclude = {
  members: { include: { user: { select: publicUserSelect } } },
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: messageInclude,
  },
} as const;

// Finds an existing 1:1 conversation between the two users or creates it.
export async function findOrCreateDirectConversation(
  userA: string,
  userB: string
) {
  const existing = await prisma.conversation.findFirst({
    where: {
      type: "direct",
      AND: [
        { members: { some: { userId: userA } } },
        { members: { some: { userId: userB } } },
      ],
    },
    include: conversationInclude,
  });
  if (existing) return { conversation: existing, created: false };

  const memberIds = userA === userB ? [userA] : [userA, userB];
  const conversation = await prisma.conversation.create({
    data: {
      type: "direct",
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
    include: conversationInclude,
  });

  // Make already-connected sockets of both users join the new room and
  // tell their clients about the conversation.
  const io = getIo();
  for (const userId of memberIds) {
    io.in(userRoom(userId)).socketsJoin(convRoom(conversation.id));
    io.to(userRoom(userId)).emit("conversation:new", conversation);
  }
  return { conversation, created: true };
}

// Ensures the bot user that represents an integration (Hermes/OpenClaw)
// exists, creating it with an unusable random password on first use.
export async function ensureBotUser(username: string, displayName: string) {
  const email = `${username}@bots.chat-universal.local`;
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      username,
      displayName,
      isBot: true,
      passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
    },
  });
}
