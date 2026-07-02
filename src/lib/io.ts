import type { Server } from "socket.io";

// Singleton holding the Socket.IO server so REST routes and webhooks can
// emit real-time events without circular imports.
let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

export function getIo(): Server {
  if (!io) throw new Error("Socket.IO server not initialized yet");
  return io;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const convRoom = (conversationId: string) => `conv:${conversationId}`;
