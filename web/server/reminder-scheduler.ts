// ─── Reminder Scheduler ──────────────────────────────────────────────────────
// Checks every 60 seconds for due reminders and sends push notifications.

import { getDueReminders, fireReminder } from "./assistant-store.js";
import { sendNotification } from "./push-notifications.js";

let intervalId: ReturnType<typeof setInterval> | null = null;

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
