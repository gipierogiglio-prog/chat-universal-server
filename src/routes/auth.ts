import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, publicUserSelect } from "../db.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { parseBody } from "../lib/validate.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email().max(254),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers and underscore"),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64).optional(),
});

router.post("/register", async (req, res) => {
  const data = parseBody(registerSchema, req, res);
  if (!data) return;

  const email = data.email.toLowerCase();
  const conflict = await prisma.user.findFirst({
    where: { OR: [{ email }, { username: data.username }] },
  });
  if (conflict) {
    return res.status(409).json({
      error:
        conflict.email === email ? "Email already in use" : "Username already in use",
    });
  }

  const user = await prisma.user.create({
    data: {
      email,
      username: data.username,
      displayName: data.displayName ?? data.username,
      passwordHash: await bcrypt.hash(data.password, 10),
    },
    select: publicUserSelect,
  });

  res.status(201).json({ token: signToken(user.id), user });
});

const loginSchema = z.object({
  // Accepts an email address or a username.
  identifier: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
});

router.post("/login", async (req, res) => {
  const data = parseBody(loginSchema, req, res);
  if (!data) return;

  const identifier = data.identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { username: data.identifier }] },
  });
  if (!user || user.isBot || !(await bcrypt.compare(data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { passwordHash, ...publicUser } = user;
  res.json({ token: signToken(user.id), user: publicUser });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: publicUserSelect,
  });
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ user });
});

export default router;
