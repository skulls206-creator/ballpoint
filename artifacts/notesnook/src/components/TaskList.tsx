import { useMemo, useState, useRef, useEffect } from 'react';
import { format, isToday, isPast, isTomorrow, isThisYear } from 'date-fns';
import {
  CheckSquare, Square, CalendarDays, FileText,
  Plus, ListTodo, Calendar, Clock, CheckCheck, Menu,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { selectTasksByView, selectTaskCounts, Task, TaskView } from '../lib/tasks';
import { cn } from '../lib/utils';

// Convert a Date to the "YYYY-MM-DDTHH:mm" format that datetime-local inputs
// expect (they use LOCAL time, not UTC).
function toLocalInputValue(d: Date): string {
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

// ─── Due Date Popover ─────────────────────────────────────────────────────────
function DueDatePopover({
  task,
  onClose,
}: { task: Task; onClose: () => void }) {
  const setTaskDueDate = useNotesStore(s => s.setTaskDueDate);
  // Always pre-fill — if no due date, default to tomorrow at 9 am
  const [value, setValue] = useState(() => {
    if (task.dueDate) return toLocalInputValue(new Date(task.dueDate));
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toLocalInputValue(d);
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const save = () => {
    // `new Date(value)` treats the local-time string as local time, then toISOString() → UTC ✓
    setTaskDueDate(task.id, value ? new Date(value).toISOString() : null);
    onClose();
  };
  const clear = () => {
    setTaskDueDate(task.id, null);
    onClose();
  };

  // Quick-pick shortcuts
  const setQuick = (offsetDays: number, hour = 9) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, 0, 0, 0);
    setValue(toLocalInputValue(d));
  };

  return (
    <div ref={ref}
      className="absolute left-0 top-7 z-[200] w-60 bg-popover border border-popover-border rounded-xl shadow-xl p-3 space-y-2 animate-in fade-in zoom-in-95 duration-100">
      <p className="text-[11px] font-medium text-foreground">Set due date & time</p>

      {/* Quick picks */}
      <div className="flex gap-1 flex-wrap">
        {[
          { label: 'Today',     days: 0, hour: 9 },
          { label: 'Tomorrow',  days: 1, hour: 9 },
          { label: 'Next week', days: 7, hour: 9 },
        ].map(({ label, days, hour }) => (
          <button key={label} onClick={() => setQuick(days, hour)}
            className="px-2 py-0.5 rounded-full bg-muted border border-border text-[10px] text-foreground/70 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors">
            {label}
          </button>
        ))}
      </div>

      <input
        type="datetime-local"
        value={value}
        min={toLocalInputValue(new Date())}
        onChange={e => setValue(e.target.value)}
        className="w-full text-[11px] bg-muted border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
        autoFocus
      />
      <div className="flex gap-1.5">
        <button onClick={save}
          className="flex-1 h-6 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity">
          Set
        </button>
        {task.dueDate && (
          <button onClick={clear}
            className="flex-1 h-6 rounded border border-destructive/40 text-destructive text-[11px] hover:bg-destructive/10 transition-colors">
            Clear
          </button>
        )}
      </div>
      <p className="text-[9px] text-muted-foreground/40 leading-relaxed">
        A notification fires when the time arrives — keep this tab open.
      </p>
    </div>
  );
}

// ─── Task Row ─────────────────────────────────────────────────────────────────
function TaskRow({ task }: { task: Task }) {
  const toggleTask   = useNotesStore(s => s.toggleTask);
  const selectNote   = useNotesStore(s => s.selectNote);
  const setActiveSection = useNotesStore(s => s.setActiveSection);
  const [duePop, setDuePop] = useState(false);

  const dueDateLabel = useMemo(() => {
    if (!task.dueDate) return null;
    const d = new Date(task.dueDate);
    // Check whether a specific time was set (not midnight)
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    const timeStr = hasTime ? ` · ${format(d, 'h:mm a')}` : '';
    if (isToday(d)) return `Today${timeStr}`;
    if (isTomorrow(d)) return `Tomorrow${timeStr}`;
    if (isPast(d) && !task.completed) return `${format(d, 'MMM d')}${timeStr} · overdue`;
    const dateStr = isThisYear(d) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy');
    return `${dateStr}${timeStr}`;
  }, [task.dueDate, task.completed]);

  const isOverdue = task.dueDate && isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate)) && !task.completed;

  const openNote = () => {
    setActiveSection({ type: 'all' });
    selectNote(task.noteId);
  };

  return (
    <div className={cn(
      "group flex items-start gap-2 px-3 py-2 border-b border-border/30 transition-colors",
      task.completed ? "opacity-50" : "hover:bg-muted/40"
    )}>
      {/* Checkbox */}
      <button
        onClick={() => toggleTask(task.id)}
        className={cn(
          "mt-0.5 shrink-0 transition-colors",
          task.completed ? "text-primary" : "text-muted-foreground/40 hover:text-primary"
        )}
        title={task.completed ? "Mark incomplete" : "Mark complete"}
      >
        {task.completed
          ? <CheckSquare size={14} className="fill-primary/20" />
          : <Square size={14} />
        }
      </button>

      {/* Text + meta */}
      <div className="flex-1 min-w-0">
        <p className={cn("text-[12px] leading-snug break-words",
          task.completed ? "line-through text-muted-foreground" : "text-foreground/90"
        )}>
          {task.text}
        </p>

        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {/* Source note badge */}
          <button
            onClick={openNote}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-primary transition-colors"
          >
            <FileText size={9} />
            <span className="truncate max-w-[100px]">{task.noteTitle}</span>
          </button>

          {/* Due date badge */}
          <div className="relative">
            <button
              onClick={() => setDuePop(p => !p)}
              className={cn(
                "flex items-center gap-0.5 text-[10px] transition-colors",
                isOverdue
                  ? "text-destructive"
                  : task.dueDate
                  ? "text-primary"
                  : "text-muted-foreground/30 hover:text-muted-foreground"
              )}
            >
              <CalendarDays size={9} />
              <span>{dueDateLabel ?? 'no date'}</span>
            </button>
            {duePop && (
              <DueDatePopover task={task} onClose={() => setDuePop(false)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Task List ────────────────────────────────────────────────────────────────
export function TaskList({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const activeSection  = useNotesStore(s => s.activeSection);
  const tasks          = useNotesStore(s => s.tasks);
  const vaultHandle    = useNotesStore(s => s.vaultHandle);
  const proxyVault     = useNotesStore(s => s.proxyVault);
  const createTaskNote = useNotesStore(s => s.createTaskNote);
  const hasVault       = !!(vaultHandle || proxyVault);

  const view = (activeSection.type.replace('tasks-', '') as TaskView);

  const filteredTasks = useMemo(
    () => selectTasksByView(tasks, view),
    [tasks, view]
  );

  const counts = useMemo(() => selectTaskCounts(tasks), [tasks]);

  const viewMeta: Record<TaskView, { label: string; icon: React.ReactNode; empty: string }> = {
    inbox:    { label: 'Inbox',     icon: <ListTodo size={13} />,   empty: 'No tasks without a due date' },
    today:    { label: 'Today',     icon: <Clock size={13} />,      empty: 'Nothing due today — nice!' },
    upcoming: { label: 'Upcoming',  icon: <Calendar size={13} />,   empty: 'No upcoming tasks' },
    done:     { label: 'Completed', icon: <CheckCheck size={13} />, empty: 'Nothing completed yet' },
  };

  const meta = viewMeta[view];
  const count = counts[view];

  return (
    <div className="w-full md:w-[240px] shrink-0 flex flex-col h-full border-r border-border bg-card/40 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border/60 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground/60">
            {/* Hamburger — mobile only */}
            <button
              onClick={onOpenSidebar}
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-foreground/50 hover:text-foreground hover:bg-muted transition-colors -ml-1"
              title="Menu"
            >
              <Menu size={18} />
            </button>
            <span className="text-primary/70">{meta.icon}</span>
            <span className="text-[12px] md:text-[11px] font-semibold uppercase tracking-wider">{meta.label}</span>
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
        </div>
      </div>

      {/* Add task button */}
      {hasVault && view !== 'done' && (
        <div className="px-2 py-1.5 border-b border-border/40 shrink-0">
          <button
            onClick={() => createTaskNote()}
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/8 text-primary/70 hover:bg-primary/15 hover:text-primary text-[11px] font-medium transition-colors"
          >
            <Plus size={11} /> New task
          </button>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 px-4 text-center">
            <ListTodo size={28} className="mb-2 opacity-30" />
            <p className="text-[11px]">{meta.empty}</p>
            {!hasVault && (
              <p className="text-[10px] mt-1 opacity-60">Open a vault to see tasks</p>
            )}
          </div>
        ) : (
          filteredTasks.map(task => <TaskRow key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}
