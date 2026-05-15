import { useState, useMemo, useCallback } from 'react';
import {
  ListTodo, Clock, Calendar, CheckCheck, Plus, Search,
  Menu, ArrowUpDown, Filter,
} from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { selectTasksFiltered, selectTaskCounts, TaskView, TaskPriorityFilter, TaskSortBy } from '../lib/tasks';
import { TaskCard } from './TaskCard';
import { TaskDetailPanel } from './TaskDetailPanel';
import { cn } from '../lib/utils';

const VIEW_META: Record<TaskView, { label: string; icon: React.ReactNode; empty: string }> = {
  inbox:    { label: 'Inbox',     icon: <ListTodo size={16} />,   empty: 'All caught up!' },
  today:    { label: 'Today',     icon: <Clock size={16} />,      empty: 'Nothing due today — nice!' },
  upcoming: { label: 'Upcoming',  icon: <Calendar size={16} />,   empty: 'No upcoming tasks' },
  done:     { label: 'Completed', icon: <CheckCheck size={16} />, empty: 'Nothing completed yet' },
};

const PRIORITY_FILTERS: { value: TaskPriorityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
];

const SORT_OPTIONS: { value: TaskSortBy; label: string }[] = [
  { value: 'dueDate', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'createdAt', label: 'Created' },
];

export function TaskWorkspace({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const activeSection = useNotesStore(s => s.activeSection);
  const tasks = useNotesStore(s => s.tasks);
  const vaultHandle = useNotesStore(s => s.vaultHandle);
  const proxyVault = useNotesStore(s => s.proxyVault);
  const createTaskNote = useNotesStore(s => s.createTaskNote);

  const view = (activeSection.type.replace('tasks-', '') as TaskView);

  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>('all');
  const [sortBy, setSortBy] = useState<TaskSortBy>('dueDate');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);

  const meta = VIEW_META[view];
  const counts = useMemo(() => selectTaskCounts(tasks), [tasks]);
  const hasVault = !!(vaultHandle || proxyVault);

  // Apply search filter before other filters
  const allFiltered = useMemo(() => {
    const base = selectTasksFiltered(tasks, view, priorityFilter, sortBy);
    if (!searchQuery) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(t => t.text.toLowerCase().includes(q) || t.noteTitle?.toLowerCase().includes(q));
  }, [tasks, view, priorityFilter, sortBy, searchQuery]);

  const selectedTask = selectedTaskId ? tasks[selectedTaskId] ?? null : null;

  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setMobileDetail(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedTaskId(null);
    setMobileDetail(false);
  }, []);

  const count = counts[view];

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Main task list */}
      <div className={cn(
        'flex-1 flex flex-col h-full min-w-0',
        mobileDetail && selectedTask ? 'hidden md:flex' : 'flex'
      )}>
        {/* Header bar */}
        <div className="px-4 py-2.5 border-b border-border shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Hamburger */}
              <button onClick={onOpenSidebar}
                className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-foreground/50 hover:text-foreground hover:bg-muted transition-colors -ml-1">
                <Menu size={18} />
              </button>
              <span className="text-primary/70">{meta.icon}</span>
              <h2 className="text-[14px] font-semibold text-foreground">{meta.label}</h2>
              <span className="text-[11px] text-muted-foreground tabular-nums font-medium">{count}</span>
            </div>
            <div className="flex items-center gap-1">
              {hasVault && view !== 'done' && (
                <button onClick={() => createTaskNote()}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 active:scale-95 transition-all shadow-sm">
                  <Plus size={14} /> New task
                </button>
              )}
            </div>
          </div>

          {/* Search + filter row */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
              <input type="search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search tasks…"
                className="w-full h-7 pl-7 pr-2 text-[11px] bg-muted/60 border-0 rounded-md outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50" />
            </div>
            <button onClick={() => setShowFilters(p => !p)}
              className={cn("h-7 px-2 rounded-md text-[10px] font-medium flex items-center gap-1 transition-colors",
                showFilters ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground/60 hover:text-foreground")}>
              <Filter size={11} /> Filter
            </button>
            <div className="relative">
              <button onClick={() => {
                const opts: TaskSortBy[] = ['dueDate', 'priority', 'createdAt'];
                const idx = opts.indexOf(sortBy);
                setSortBy(opts[(idx + 1) % opts.length]);
              }}
                className="h-7 px-2 rounded-md text-[10px] font-medium flex items-center gap-1 bg-muted/60 text-muted-foreground/60 hover:text-foreground transition-colors">
                <ArrowUpDown size={11} /> {SORT_OPTIONS.find(o => o.value === sortBy)?.label}
              </button>
            </div>
          </div>

          {/* Priority filter pills */}
          {showFilters && (
            <div className="flex gap-1 flex-wrap pb-1">
              {PRIORITY_FILTERS.map(f => (
                <button key={f.value} onClick={() => setPriorityFilter(f.value)}
                  className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
                    priorityFilter === f.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground/60 hover:text-foreground hover:bg-muted/80'
                  )}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {allFiltered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 px-4 text-center">
              <span className="opacity-30 mb-2">{meta.icon}</span>
              <p className="text-[12px]">{searchQuery ? 'No matching tasks' : meta.empty}</p>
              {!hasVault && (
                <p className="text-[10px] mt-1 opacity-60">Open a vault to see tasks</p>
              )}
            </div>
          ) : (
            allFiltered.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onSelect={() => handleSelectTask(task.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail panel — desktop */}
      {selectedTask && (
        <div className="hidden md:block">
          <TaskDetailPanel
            task={selectedTask}
            onClose={handleCloseDetail}
          />
        </div>
      )}

      {/* Detail panel — mobile slide-up */}
      {selectedTask && mobileDetail && (
        <div className="md:hidden">
          <TaskDetailPanel
            task={selectedTask}
            onClose={handleCloseDetail}
            onMobile
          />
        </div>
      )}
    </div>
  );
}
