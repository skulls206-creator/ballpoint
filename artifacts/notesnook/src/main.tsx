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

        // Tell waiting SW to take over immediately when user accepts update
        window.__swRegistration = reg;

        // Listen for "a new version is ready" so the app can offer a reload
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content available — dispatch a custom event the UI can listen to
              window.dispatchEvent(new CustomEvent('sw-update-available'));
            }
          });
        });

        // Listen for messages from SW (e.g. "open this note" on notification click)
        navigator.serviceWorker.addEventListener('message', event => {
          if (event.data?.type === 'OPEN_NOTE') {
            useNotesStore.getState().selectNote(event.data.noteId);
          }
        });
      })
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

// ── Manifest shortcut: ?action=new ────────────────────────────────────────────
// Triggered when the user opens the app via the "New Note" shortcut
// in the installed PWA's jump list / long-press menu.
if (typeof window !== 'undefined') {
  const onStoreReady = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'new') {
      // Wait briefly for the store to init
      setTimeout(() => {
        const { vaultHandle, createNewNote } = useNotesStore.getState();
        if (vaultHandle) createNewNote();
        // Clean the URL without reloading
        window.history.replaceState({}, '', '/');
      }, 1000);
    }
  };
  // Run after hydration
  window.addEventListener('load', onStoreReady, { once: true });
}

// ── Notification permission request ───────────────────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
  setTimeout(() => {
    Notification.requestPermission().then(perm => {
      console.info('[Notifications] Permission:', perm);
    });
  }, 5000);
}

// ── Reminder scheduler ────────────────────────────────────────────────────────
async function checkReminders() {
  const state = useNotesStore.getState();
  if (!state.userId) return;

  const now = Date.now();
  for (const note of state.notes) {
    if (note.hasReminder && note.reminderStatus === 'pending' && note.reminderTime) {
      const reminderAt = new Date(note.reminderTime).getTime();
      if (now >= reminderAt) {
        await state.fireReminder(note.id);

        const title = `Reminder: ${note.title}`;
        const body = 'Your scheduled reminder has arrived. Click to open.';

        if ('serviceWorker' in navigator && Notification.permission === 'granted') {
          try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(title, {
              body,
              icon: `${import.meta.env.BASE_URL}favicon.svg`,
              badge: `${import.meta.env.BASE_URL}favicon.svg`,
              data: { noteId: note.id },
              actions: [
                { action: 'open',    title: 'Open Note' },
                { action: 'dismiss', title: 'Dismiss'   },
              ],
            });
          } catch {
            if (Notification.permission === 'granted') new Notification(title, { body });
          }
        } else if (Notification.permission === 'granted') {
          new Notification(title, { body });
        }
      }
    }
  }
}

checkReminders();
setInterval(checkReminders, 60_000);

// ── Render ────────────────────────────────────────────────────────────────────
createRoot(document.getElementById('root')!).render(<App />);

// Type augment for the SW registration handle
declare global {
  interface Window { __swRegistration?: ServiceWorkerRegistration; }
}
