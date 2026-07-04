import { getIo, convRoom } from "./io.js";

// Re-emits a synthetic "typing" event for a bot user on a fixed cadence so
// the client's typing indicator (which expires 3s after the last event)
// stays visible while Hermes is still generating a reply. Stopped either by
// the webhook route once the reply is delivered, or by the safety timeout
// below if the agent never responds.
const TYPING_INTERVAL_MS = 2000;
const MAX_TYPING_MS = 120_000;

const timers = new Map<string, NodeJS.Timeout>();

export function startBotTyping(conversationId: string, botUserId: string): void {
  stopBotTyping(conversationId);

  const startedAt = Date.now();
  const emit = () => {
    getIo().to(convRoom(conversationId)).emit("typing", { conversationId, userId: botUserId });
  };

  emit();
  const interval = setInterval(() => {
    if (Date.now() - startedAt > MAX_TYPING_MS) {
      stopBotTyping(conversationId);
      return;
    }
    emit();
  }, TYPING_INTERVAL_MS);

  timers.set(conversationId, interval);
}

export function stopBotTyping(conversationId: string): void {
  const timer = timers.get(conversationId);
  if (timer) {
    clearInterval(timer);
    timers.delete(conversationId);
  }
}
