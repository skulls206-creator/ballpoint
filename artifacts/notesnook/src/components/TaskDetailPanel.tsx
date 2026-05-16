import { useState, useRef } from 'react';
import { X, FileText, Plus, Trash2, CheckSquare, Square } from 'lucide-react';

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
import { useNotesStore } from '../lib/store';
import { Task } from '../lib/tasks';
import { cn } from '../lib/utils';

interface Props {
  task: Task;
  onClose: () => void;
  onMobile?: boolean;
}

const PRIORITY_OPTIONS: { value: NonNullable<Task['priority']>; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: 'bg-red-500' },
  { value: 'high',   label: 'High',   color: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
  { value: 'low',    label: 'Low',    color: 'bg-blue-500' },
];

export function TaskDetailPanel({ task, onClose, onMobile }: Props) {
  const setTaskPriority = useNotesStore(s => s.setTaskPriority);
  const setTaskDescription = useNotesStore(s => s.setTaskDescription);
  const setTaskSubtasks = useNotesStore(s => s.setTaskSubtasks);
  const selectNote = useNotesStore(s => s.selectNote);
  const setActiveSection = useNotesStore(s => s.setActiveSection);
  const setTaskDueDate = useNotesStore(s => s.setTaskDueDate);

  const [tab, setTab] = useState<'details' | 'subtasks'>('details');
  const [title, setTitle] = useState(task.text);
  const [description, setDescription] = useState(task.description ?? '');
  const [newStep, setNewStep] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const subtasks = task.subtasks ?? [];

  const handleOpenNote = () => {
    setActiveSection({ type: 'all' });
    selectNote(task.noteId);
    onClose();
  };

  const addSubtask = () => {
    if (!newStep.trim()) return;
    const newSubtask = { id: uid(), text: newStep.trim(), completed: false };
    setTaskSubtasks(task.id, [...subtasks, newSubtask]);
    setNewStep('');
    inputRef.current?.focus();
  };

  const toggleSubtask = (id: string) => {
    setTaskSubtasks(task.id, subtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s));
  };

  const removeSubtask = (id: string) => {
    setTaskSubtasks(task.id, subtasks.filter(s => s.id !== id));
  };

  const content = (
    <div className="flex flex-col h-full bg-card/60">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <h3 className="text-[13px] font-semibold text-foreground truncate">{task.text}</h3>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {(['details', 'subtasks'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors",
              tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground/50 hover:text-foreground"
            )}>
            {t === 'details' ? 'Details' : `Subtasks (${subtasks.filter(s => s.completed).length}/${subtasks.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'details' ? (
          <>
            {/* Title */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 block">Title</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring"
                placeholder="Task title" />
            </div>

            {/* Description */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 block">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring resize-none"
                placeholder="Add notes..." />
            </div>

            {/* Priority */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Priority</label>
              <div className="flex gap-1.5">
                {PRIORITY_OPTIONS.map(p => (
                  <button key={p.value} onClick={() => setTaskPriority(task.id, p.value)}
                    className={cn(
                      "flex-1 py-1.5 rounded-md text-[10px] font-semibold transition-all",
                      task.priority === p.value ? `${p.color} text-white shadow-sm` : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}>
                    {p.label}
                  </button>
                ))}
                <button onClick={() => setTaskPriority(task.id, undefined as any)}
                  className={cn(
                    "py-1.5 px-2.5 rounded-md text-[10px] font-medium transition-all",
                    !task.priority ? 'bg-muted-foreground/20 text-foreground' : 'bg-muted text-muted-foreground/50 hover:bg-muted/80'
                  )}>
                  None
                </button>
              </div>
            </div>

            {/* Due date */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 block">Due date</label>
              <input type="datetime-local" value={task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : ''}
                onChange={e => setTaskDueDate(task.id, e.target.value ? new Date(e.target.value).toISOString() : null)}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring" />
            </div>

            {/* Linked note */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 block">Linked note</label>
              <button onClick={handleOpenNote}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background text-[12px] text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors">
                <FileText size={14} className="text-primary/60" />
                <span className="flex-1 text-left truncate">{task.noteTitle || task.noteId}</span>
                <span className="text-[10px] text-primary">Open →</span>
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Add subtask */}
            <div className="flex gap-1.5">
              <input ref={inputRef} type="text" value={newStep} onChange={e => setNewStep(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSubtask()}
                placeholder="Add a step…"
                className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-[13px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40" />
              <button onClick={addSubtask} disabled={!newStep.trim()}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors">
                <Plus size={14} />
              </button>
            </div>

            {/* Subtask list */}
            <div className="space-y-0.5">
              {subtasks.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/50 text-center py-4">No subtasks yet</p>
              ) : (
                subtasks.map(s => (
                  <div key={s.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors group/sub">
                    <button onClick={() => toggleSubtask(s.id)}
                      className={cn("shrink-0", s.completed ? "text-primary" : "text-muted-foreground/30 hover:text-primary")}>
                      {s.completed ? <CheckSquare size={14} className="fill-primary/20" /> : <Square size={14} />}
                    </button>
                    <span className={cn("flex-1 text-[12px]", s.completed ? "line-through text-muted-foreground" : "text-foreground/80")}>
                      {s.text}
                    </span>
                    <button onClick={() => removeSubtask(s.id)}
                      className="opacity-0 group-hover/sub:opacity-100 p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-all">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (onMobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in slide-in-from-bottom duration-300">
        {content}
      </div>
    );
  }

  return (
    <div className="w-[360px] shrink-0 border-l border-border h-full overflow-hidden">
      {content}
    </div>
  );
}
