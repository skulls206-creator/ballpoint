import { FolderOpen, HardDrive, Shield, Zap, Lock, Menu } from 'lucide-react';
import { useNotesStore } from '../lib/store';
import { useAuth } from '../lib/authContext';
import { isFileSystemSupported } from '../lib/fileSystem';

export function WelcomeScreen({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const { openNewVault } = useNotesStore();
  const { user } = useAuth();

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center h-12 px-4 border-b border-border shrink-0">
        <button
          onClick={onOpenSidebar}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        >
          <Menu size={20} />
        </button>
        <span className="ml-2 text-sm font-semibold text-foreground">Ballpoint.one</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-sm w-full text-center space-y-6">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Zap size={22} strokeWidth={1.5} />
        </div>

        {/* Heading */}
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Local<span className="text-primary">Notes</span>
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Select a folder on your computer to store your notes as plain Markdown files.
          </p>
          {user && (
            <p className="text-xs text-muted-foreground/60">
              Logged in as <span className="font-medium text-foreground/70">{user.email}</span>
            </p>
          )}
        </div>

        {/* Action */}
        {!isFileSystemSupported ? (
          <div className="bg-destructive/10 text-destructive p-4 rounded-lg border border-destructive/20 text-left">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-1">
              <Shield size={14} /> Browser not supported
            </h3>
            <p className="text-xs opacity-80">Use Chrome, Edge, or a Chromium-based browser for File System Access API support.</p>
          </div>
        ) : (
          <button
            onClick={() => user && openNewVault(user.id)}
            className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 active:opacity-80 transition-opacity shadow-sm shadow-primary/20"
          >
            <FolderOpen size={15} /> Select Notes Folder
          </button>
        )}

        {/* Feature grid */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          {[
            { icon: <HardDrive size={13} />, label: '100% Local', desc: '.md files on disk' },
            { icon: <Lock size={13} />,      label: 'Private',    desc: 'No cloud sync'    },
            { icon: <Zap size={13} />,       label: 'Offline',    desc: 'Works everywhere' },
          ].map(f => (
            <div key={f.label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/40 border border-border/40">
              <span className="text-primary">{f.icon}</span>
              <span className="text-[10px] font-semibold text-foreground/80">{f.label}</span>
              <span className="text-[9px] text-muted-foreground">{f.desc}</span>
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
