// ─── Reminder Scheduler ──────────────────────────────────────────────────────
// Checks every 60 seconds for due reminders and sends push notifications.

import { getDueReminders, fireReminder, listTodos } from "./assistant-store.js";
import { sendNotification } from "./push-notifications.js";

let intervalId: ReturnType<typeof setInterval> | null = null;

// Dedup set for delegation notifications: key `${todoId}:${dueDate}`.
// Prevents the same "delegation is due today/tomorrow" notification from
// firing every minute. Cleared on process restart (at most one duplicate).
const notifiedDelegations = new Set<string>();

async function checkReminders(): Promise<void> {
  const due = getDueReminders();
  for (const reminder of due) {
    try {
      await sendNotification("Erinnerung", reminder.text, {
        tag: `reminder-${reminder.id}`,
        icon: "/icon-192.png",
      });
      console.log(`[reminder-scheduler] Fired: "${reminder.text}"`);
    } catch (err) {
      console.error(`[reminder-scheduler] Failed to send notification for "${reminder.text}":`, err);
    }
    fireReminder(reminder.id);
  }

  // Check for delegated todos with approaching due dates.
  // Notify once per (todoId, dueDate) pair to avoid per-minute spam.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const todos = listTodos({ done: false });

    // Garbage-collect keys whose dueDate is neither today nor tomorrow anymore
    for (const key of notifiedDelegations) {
      const dueDate = key.split(":")[1];
      if (dueDate !== today && dueDate !== tomorrow) notifiedDelegations.delete(key);
    }

    for (const todo of todos) {
      if (!todo.delegatedTo || !todo.dueDate) continue;
      if (todo.dueDate !== today && todo.dueDate !== tomorrow) continue;
      const key = `${todo.id}:${todo.dueDate}`;
      if (notifiedDelegations.has(key)) continue;

      const label = todo.dueDate === today ? "heute" : "morgen";
      await sendNotification(
        "Delegation fällig",
        `${todo.delegatedTo}: "${todo.text}" — fällig ${label}`,
        { tag: `delegation-${todo.id}-${todo.dueDate}`, icon: "/icon-192.png" },
      );
      notifiedDelegations.add(key);
    }
  } catch (err) {
    console.error("[reminder-scheduler] Failed to check delegation due dates:", err);
  }
}

export function startReminderScheduler(): void {
  if (intervalId) return;
  // Check immediately on start, then every 60 seconds
  checkReminders();
  intervalId = setInterval(checkReminders, 60_000);
  console.log("[reminder-scheduler] Started (checking every 60s)");
}

export function stopReminderScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
