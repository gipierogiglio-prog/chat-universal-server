import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (typeof payload === "object" && typeof payload.sub === "string") {
      return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.userId = userId;
  next();
}

export function requireApiKey(expectedKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!expectedKey) {
      return res.status(503).json({ error: "Integration not configured" });
    }
    const provided = req.headers["x-api-key"];
    if (provided !== expectedKey) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    next();
  };
}
