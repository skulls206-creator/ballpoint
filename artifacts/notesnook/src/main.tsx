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
/** Tracks task IDs that already fired a due-date notification this session */
const firedTaskNotifs = new Set<string>();

async function fireNotification(title: string, body: string, noteId?: string) {
  if (Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body,
        icon: `${import.meta.env.BASE_URL}favicon.svg`,
        badge: `${import.meta.env.BASE_URL}favicon.svg`,
        data: noteId ? { noteId } : undefined,
        actions: [
          { action: 'open',    title: 'Open' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      });
      return;
    } catch { /* fall through */ }
  }
  new Notification(title, { body });
}

async function checkReminders() {
  const state = useNotesStore.getState();
  if (!state.userId) return;

  const now = Date.now();

  // ── Note-level reminders ──────────────────────────────────────────────────
  for (const note of state.notes) {
    if (note.hasReminder && note.reminderStatus === 'pending' && note.reminderTime) {
      if (now >= new Date(note.reminderTime).getTime()) {
        await state.fireReminder(note.id);
        await fireNotification(
          `Reminder: ${note.title}`,
          'Your scheduled reminder has arrived. Click to open.',
          note.id,
        );
      }
    }
  }

  // ── Task due-date notifications ───────────────────────────────────────────
  for (const task of Object.values(state.tasks)) {
    if (task.completed || !task.dueDate || firedTaskNotifs.has(task.id)) continue;
    if (now >= new Date(task.dueDate).getTime()) {
      firedTaskNotifs.add(task.id);
      await fireNotification(
        `Task due: ${task.text}`,
        `From note: ${task.noteTitle}`,
        task.noteId,
      );
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
