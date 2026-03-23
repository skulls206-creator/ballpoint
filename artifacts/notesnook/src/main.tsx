import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { useNotesStore } from './lib/store';

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(reg => {
        console.info('[SW] Registered');
        // Listen for messages from SW (e.g. "open this note" on notification click)
        navigator.serviceWorker.addEventListener('message', event => {
          if (event.data?.type === 'OPEN_NOTE') {
            useNotesStore.getState().selectNote(event.data.noteId);
          }
        });
        return reg;
      })
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

// ── Notification permission request ───────────────────────────────────────────
// Ask politely after a short delay (avoids immediate permission prompt on load).
if ('Notification' in window && Notification.permission === 'default') {
  setTimeout(() => {
    Notification.requestPermission().then(perm => {
      console.info('[Notifications] Permission:', perm);
    });
  }, 5000);
}

// ── Reminder scheduler ───────────────────────────────────────────────────────
// Checks every 60 seconds while the app is open.
// Best-effort: fires if the tab/PWA is open. Notifications via SW when possible.
async function checkReminders() {
  const state = useNotesStore.getState();
  if (!state.userId) return;

  const now = Date.now();
  for (const note of state.notes) {
    if (note.hasReminder && note.reminderStatus === 'pending' && note.reminderTime) {
      const reminderAt = new Date(note.reminderTime).getTime();
      if (now >= reminderAt) {
        // Mark as fired in store/IndexedDB
        await state.fireReminder(note.id);

        const title = `Reminder: ${note.title}`;
        const body = 'Your scheduled reminder has arrived. Click to open.';

        // Try SW notification (shows even if tab is not focused)
        if ('serviceWorker' in navigator && Notification.permission === 'granted') {
          try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(title, {
              body,
              icon: `${import.meta.env.BASE_URL}icon-192.png`,
              badge: `${import.meta.env.BASE_URL}icon-192.png`,
              data: { noteId: note.id },
              actions: [
                { action: 'open',    title: 'Open Note' },
                { action: 'dismiss', title: 'Dismiss'   },
              ],
            });
          } catch {
            // Fallback to basic Notification API
            if (Notification.permission === 'granted') {
              new Notification(title, { body });
            }
          }
        } else if (Notification.permission === 'granted') {
          new Notification(title, { body });
        }
      }
    }
  }
}

// Run once immediately, then every 60 seconds
checkReminders();
setInterval(checkReminders, 60_000);

// ── Render ────────────────────────────────────────────────────────────────────
createRoot(document.getElementById('root')!).render(<App />);
