import { Router } from "express";
import { prisma, publicUserSelect } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/users/search?q=... — find users by email or username.
router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ users: [] });

  const users = await prisma.user.findMany({
    where: {
      id: { not: req.userId },
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: publicUserSelect,
    take: 20,
  });
  res.json({ users });
});

export default router;
