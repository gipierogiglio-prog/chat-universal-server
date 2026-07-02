import { Router } from "express";
import { z } from "zod";
import { prisma, publicUserSelect } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { parseBody } from "../lib/validate.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const contacts = await prisma.contact.findMany({
    where: { ownerId: req.userId },
    include: { target: { select: publicUserSelect } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ contacts });
});

const addContactSchema = z.object({ userId: z.string().min(1) });

router.post("/", async (req, res) => {
  const data = parseBody(addContactSchema, req, res);
  if (!data) return;
  if (data.userId === req.userId) {
    return res.status(400).json({ error: "Cannot add yourself" });
  }

  const target = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  const contact = await prisma.contact.upsert({
    where: { ownerId_targetId: { ownerId: req.userId!, targetId: data.userId } },
    create: { ownerId: req.userId!, targetId: data.userId },
    update: {},
    include: { target: { select: publicUserSelect } },
  });
  res.status(201).json({ contact });
});

router.delete("/:id", async (req, res) => {
  const deleted = await prisma.contact.deleteMany({
    where: { id: req.params.id, ownerId: req.userId },
  });
  if (deleted.count === 0) return res.status(404).json({ error: "Contact not found" });
  res.json({ ok: true });
});

export default router;
