import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, isToday, isPast, isTomorrow, isThisYear } from 'date-fns';
import {
  CheckSquare, Square, CalendarDays, FileText, AlertCircle,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { Task } from '../lib/tasks';
import { cn } from '../lib/utils';

const PRIORITY_COLORS: Record<NonNullable<Task['priority']>, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

const PRIORITY_LABELS: Record<NonNullable<Task['priority']>, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function toLocalInputValue(d: Date): string {
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function DueDatePopover({
  task, anchorRect, onClose,
}: { task: Task; anchorRect: DOMRect; onClose: () => void }) {
  const setTaskDueDate = useNotesStore(s => s.setTaskDueDate);
  const [value, setValue] = useState(() => {
    if (task.dueDate) return toLocalInputValue(new Date(task.dueDate));
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return toLocalInputValue(d);
  });
  const ref = useRef<HTMLDivElement>(null);

  return createPortal(
    <div ref={ref}
      style={{ position: 'fixed', top: anchorRect.bottom + 4, left: Math.min(anchorRect.left, window.innerWidth - 248), width: 240, zIndex: 9999 }}
      className="bg-popover border border-popover-border rounded-xl shadow-xl p-3 space-y-2 animate-in fade-in zoom-in-95 duration-100"
      onClick={e => e.stopPropagation()}
    >
      <p className="text-[11px] font-medium text-foreground">Set due date</p>
      <div className="flex gap-1 flex-wrap">
        {[
          { label: 'Today', days: 0, hour: 9 },
          { label: 'Tomorrow', days: 1, hour: 9 },
          { label: 'Next week', days: 7, hour: 9 },
        ].map(({ label, days, hour }) => (
          <button key={label} onClick={() => {
            const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0);
            setValue(toLocalInputValue(d));
          }}
            className="px-2 py-0.5 rounded-full bg-muted border border-border text-[10px] text-foreground/70 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors">
            {label}
          </button>
        ))}
      </div>
      <input type="datetime-local" value={value}
        onChange={e => setValue(e.target.value)}
        className="w-full text-[11px] bg-muted border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring" autoFocus />
      <div className="flex gap-1.5">
        <button onClick={() => { setTaskDueDate(task.id, value ? new Date(value).toISOString() : null); onClose(); }}
          className="flex-1 h-6 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity">
          Set
        </button>
        {task.dueDate && (
          <button onClick={() => { setTaskDueDate(task.id, null); onClose(); }}
            className="flex-1 h-6 rounded border border-destructive/40 text-destructive text-[11px] hover:bg-destructive/10 transition-colors">
            Clear
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

export function TaskCard({
  task, onSelect,
}: {
  task: Task;
  onSelect: () => void;
}) {
  const toggleTask = useNotesStore(s => s.toggleTask);
  const selectNote = useNotesStore(s => s.selectNote);
  const setActiveSection = useNotesStore(s => s.setActiveSection);
  const [duePop, setDuePop] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const calBtnRef = useRef<HTMLButtonElement>(null);

  const dueDateLabel = useMemo(() => {
    if (!task.dueDate) return null;
    const d = new Date(task.dueDate);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    const timeStr = hasTime ? ` · ${format(d, 'h:mm a')}` : '';
    if (isToday(d)) return `Today${timeStr}`;
    if (isTomorrow(d)) return `Tomorrow${timeStr}`;
    if (isPast(d) && !task.completed) return `${format(d, 'MMM d')}${timeStr} · overdue`;
    const dateStr = isThisYear(d) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy');
    return `${dateStr}${timeStr}`;
  }, [task.dueDate, task.completed]);

  const isOverdue = task.dueDate && isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate)) && !task.completed;

  const openNote = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveSection({ type: 'all' });
    selectNote(task.noteId);
  };

  const handleDueClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!duePop && calBtnRef.current) {
      setAnchorRect(calBtnRef.current.getBoundingClientRect());
    }
    setDuePop(p => !p);
  };

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      onClick={onSelect}
      className={cn(
        "group flex items-stretch cursor-pointer transition-colors border-b border-border/30",
        task.completed ? "opacity-50" : "hover:bg-muted/40"
      )}
    >
      {/* Priority color strip */}
      {task.priority ? (
        <div className={cn("w-1 shrink-0 rounded-l", PRIORITY_COLORS[task.priority])} />
      ) : (
        <div className="w-1 shrink-0" />
      )}

      <div className="flex-1 flex items-start gap-2.5 px-3 py-3 min-w-0">
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleTask(task.id); }}
          className={cn("mt-0.5 shrink-0 transition-colors", task.completed ? "text-primary" : "text-muted-foreground/40 hover:text-primary")}
          title={task.completed ? "Mark incomplete" : "Mark complete"}
        >
          {task.completed ? <CheckSquare size={16} className="fill-primary/20" /> : <Square size={16} />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Title */}
          <p className={cn("text-[13px] leading-snug break-words",
            task.completed ? "line-through text-muted-foreground" : "text-foreground/90"
          )}>
            {task.text}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Priority chip */}
            {task.priority && (
              <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full",
                task.priority === 'urgent' && "bg-red-500/15 text-red-500",
                task.priority === 'high' && "bg-orange-500/15 text-orange-500",
                task.priority === 'medium' && "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
                task.priority === 'low' && "bg-blue-500/15 text-blue-500",
              )}>
                {PRIORITY_LABELS[task.priority]}
              </span>
            )}

            {/* Due date badge */}
            <button
              ref={calBtnRef}
              onClick={handleDueClick}
              className={cn("flex items-center gap-0.5 text-[10px] transition-colors",
                isOverdue ? "text-destructive" : task.dueDate ? "text-primary" : "text-muted-foreground/30 hover:text-muted-foreground"
              )}
            >
              <CalendarDays size={10} />
              <span>{dueDateLabel ?? 'Add date'}</span>
            </button>

            {duePop && anchorRect && (
              <DueDatePopover task={task} anchorRect={anchorRect} onClose={() => setDuePop(false)} />
            )}

            {/* Linked note badge */}
            {task.noteId && (
              <button onClick={(e) => { e.stopPropagation(); openNote(e); }}
                className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 hover:text-primary transition-colors"
                title={task.noteTitle}
              >
                <FileText size={10} />
                <span className="truncate max-w-[80px]">{task.noteTitle}</span>
              </button>
            )}
          </div>

          {/* Subtasks progress */}
          {task.subtasks && task.subtasks.length > 0 && (
            <p className="text-[9px] text-muted-foreground/50">
              {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length} subtasks
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
