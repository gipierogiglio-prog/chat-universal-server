import { Router } from "express";
import { z } from "zod";
import { prisma, publicUserSelect } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { parseBody } from "../lib/validate.js";
import {
  conversationInclude,
  createAndDeliverMessage,
  findOrCreateDirectConversation,
  messageInclude,
} from "../lib/deliver.js";
import { getIo, convRoom, userRoom } from "../lib/io.js";

const router = Router();
router.use(requireAuth);

async function assertMembership(conversationId: string, userId: string) {
  return prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

// List the caller's conversations, most recently active first.
router.get("/", async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: req.userId } } },
    include: conversationInclude,
    orderBy: { updatedAt: "desc" },
  });
  res.json({ conversations });
});

const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("direct"), userId: z.string().min(1) }),
  z.object({
    type: z.literal("group"),
    name: z.string().min(1).max(64),
    memberIds: z.array(z.string().min(1)).min(1).max(100),
  }),
]);

router.post("/", async (req, res) => {
  const data = parseBody(createSchema, req, res);
  if (!data) return;

  if (data.type === "direct") {
    const other = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!other) return res.status(404).json({ error: "User not found" });
    const { conversation, created } = await findOrCreateDirectConversation(
      req.userId!,
      data.userId
    );
    return res.status(created ? 201 : 200).json({ conversation });
  }

  const memberIds = [...new Set([req.userId!, ...data.memberIds])];
  const existingUsers = await prisma.user.count({ where: { id: { in: memberIds } } });
  if (existingUsers !== memberIds.length) {
    return res.status(404).json({ error: "One or more members not found" });
  }

  const conversation = await prisma.conversation.create({
    data: {
      type: "group",
      name: data.name,
      members: {
        create: memberIds.map((userId) => ({
          userId,
          role: userId === req.userId ? "admin" : "member",
        })),
      },
    },
    include: conversationInclude,
  });

  const io = getIo();
  for (const userId of memberIds) {
    io.in(userRoom(userId)).socketsJoin(convRoom(conversation.id));
    io.to(userRoom(userId)).emit("conversation:new", conversation);
  }
  res.status(201).json({ conversation });
});

// Paginated message history (newest first; use ?cursor= for older pages).
router.get("/:id/messages", async (req, res) => {
  const member = await assertMembership(req.params.id, req.userId!);
  if (!member) return res.status(403).json({ error: "Not a member" });

  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  const messages = await prisma.message.findMany({
    where: { conversationId: req.params.id },
    include: messageInclude,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;
  res.json({
    messages: page.reverse(),
    nextCursor: hasMore ? page[0]!.id : null,
  });
});

const sendSchema = z.object({
  type: z.enum(["text", "image", "file"]).default("text"),
  content: z.string().max(10000).default(""),
  fileUrl: z.string().max(1024).optional(),
  fileName: z.string().max(255).optional(),
  fileSize: z.number().int().nonnegative().optional(),
});

// REST send — also used programmatically (requirement 4).
router.post("/:id/messages", async (req, res) => {
  const member = await assertMembership(req.params.id, req.userId!);
  if (!member) return res.status(403).json({ error: "Not a member" });

  const data = parseBody(sendSchema, req, res);
  if (!data) return;
  if (data.type === "text" && !data.content.trim()) {
    return res.status(400).json({ error: "Message content is empty" });
  }
  if (data.type !== "text" && !data.fileUrl) {
    return res.status(400).json({ error: "fileUrl is required for file messages" });
  }

  const message = await createAndDeliverMessage({
    conversationId: req.params.id,
    senderId: req.userId!,
    ...data,
    source: "api",
  });
  res.status(201).json({ message });
});

const addMemberSchema = z.object({ userId: z.string().min(1) });

// Add a member to a group (admins only).
router.post("/:id/members", async (req, res) => {
  const member = await assertMembership(req.params.id, req.userId!);
  if (!member) return res.status(403).json({ error: "Not a member" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
  });
  if (!conversation || conversation.type !== "group") {
    return res.status(400).json({ error: "Not a group conversation" });
  }
  if (member.role !== "admin") {
    return res.status(403).json({ error: "Only admins can add members" });
  }

  const data = parseBody(addMemberSchema, req, res);
  if (!data) return;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: publicUserSelect,
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  await prisma.conversationMember.upsert({
    where: {
      conversationId_userId: { conversationId: req.params.id, userId: data.userId },
    },
    create: { conversationId: req.params.id, userId: data.userId },
    update: {},
  });

  const updated = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: conversationInclude,
  });

  const io = getIo();
  io.in(userRoom(data.userId)).socketsJoin(convRoom(req.params.id));
  io.to(userRoom(data.userId)).emit("conversation:new", updated);
  io.to(convRoom(req.params.id)).emit("conversation:updated", updated);

  res.status(201).json({ conversation: updated });
});

export default router;
