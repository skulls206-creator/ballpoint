import { get, set } from 'idb-keyval';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;          // `${noteId}::${lineIndex}` — stable per note+line
  noteId: string;      // parent note file name (e.g. "Shopping.md")
  noteTitle: string;   // cached display name
  text: string;        // task text from Markdown
  completed: boolean;  // from [ ] or [x]
  dueDate?: string;    // ISO date string, stored in IDB only
  lineIndex: number;   // which line in the note file
  createdAt: number;
  updatedAt: number;
}

export type TaskMap = Record<string, Task>; // keyed by task.id

// ─── IDB storage ─────────────────────────────────────────────────────────────

function tasksKey(userId: number) { return `ballpoint-tasks-${userId}`; }

export async function loadAllTasks(userId: number): Promise<TaskMap> {
  return (await get<TaskMap>(tasksKey(userId))) ?? {};
}

export async function saveAllTasks(userId: number, tasks: TaskMap): Promise<void> {
  await set(tasksKey(userId), tasks);
}

// ─── Markdown ↔ Task parsing ──────────────────────────────────────────────────

/** Matches `- [ ] text` and `- [x] text` (any indent) */
const TASK_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;

export function parseTasksFromContent(
  noteId: string,
  noteTitle: string,
  content: string
): Task[] {
  const lines = content.split('\n');
  const now = Date.now();
  const tasks: Task[] = [];
  lines.forEach((line, lineIndex) => {
    const m = line.match(TASK_RE);
    if (m) {
      tasks.push({
        id: `${noteId}::${lineIndex}`,
        noteId,
        noteTitle,
        text: m[3].trim(),
        completed: m[2].toLowerCase() === 'x',
        lineIndex,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return tasks;
}

/**
 * Merge freshly-parsed tasks with the existing IDB task map.
 * Preserves dueDate, createdAt, and updatedAt from previous tasks with the same ID.
 */
export function mergeTasks(parsed: Task[], existing: TaskMap): TaskMap {
  const result: TaskMap = {};
  for (const t of parsed) {
    const prev = existing[t.id];
    result[t.id] = {
      ...t,
      dueDate:   prev?.dueDate,
      createdAt: prev?.createdAt ?? t.createdAt,
      // keep updatedAt fresh only if text or completion changed
      updatedAt: (prev && prev.text === t.text && prev.completed === t.completed)
        ? (prev.updatedAt ?? t.updatedAt)
        : t.updatedAt,
    };
  }
  return result;
}

/**
 * Toggle `[ ]` ↔ `[x]` on the given line index in a Markdown content string.
 */
export function toggleTaskInContent(
  content: string,
  lineIndex: number,
  makeCompleted: boolean
): string {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return content;
  lines[lineIndex] = makeCompleted
    ? line.replace(/\[\s\]/, '[x]')
    : line.replace(/\[x\]/i, '[ ]');
  return lines.join('\n');
}

// ─── View selectors ───────────────────────────────────────────────────────────

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'done';

function tomorrowStart(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime();
}

export function selectTasksByView(tasks: TaskMap, view: TaskView): Task[] {
  const all = Object.values(tasks);
  const tmrw = tomorrowStart();

  switch (view) {
    case 'inbox':
      return all
        .filter(t => !t.completed && !t.dueDate)
        .sort((a, b) => b.updatedAt - a.updatedAt);

    case 'today':
      return all
        .filter(t => !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() < tmrw)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

    case 'upcoming':
      return all
        .filter(t => !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() >= tmrw)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

    case 'done':
      return all
        .filter(t => t.completed)
        .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export function selectTaskCounts(tasks: TaskMap) {
  const all = Object.values(tasks);
  const tmrw = tomorrowStart();
  return {
    inbox:    all.filter(t => !t.completed && !t.dueDate).length,
    today:    all.filter(t => !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() < tmrw).length,
    upcoming: all.filter(t => !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() >= tmrw).length,
    done:     all.filter(t => t.completed).length,
  };
}
