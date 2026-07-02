import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const uploadDir = path.resolve(config.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    // Random name + original extension: prevents path traversal and collisions.
    const ext = path.extname(file.originalname).slice(0, 16).replace(/[^.\w]/g, "");
    cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
});

router.post("/", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
  });
});

export default router;
