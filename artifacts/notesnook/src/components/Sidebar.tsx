import { Plus, Search, Folder, Moon, Sun, Library, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotesStore } from "@/lib/store";
import { useAuth } from "@/lib/authContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Sidebar({
  onOpenCommandPalette
}: {
  onOpenCommandPalette: () => void
}) {
  const { createNewNote, theme, toggleTheme, notes, disconnectVault } = useNotesStore();
  const { user, logout } = useAuth();

  const handleDisconnect = () => {
    if (user) disconnectVault(user.id);
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="w-16 md:w-[280px] h-screen flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300">
      {/* Header */}
      <div className="h-16 flex items-center px-3 md:px-6 border-b border-sidebar-border/50 justify-between">
        <div className="flex items-center gap-3 overflow-hidden text-sidebar-foreground">
          <Library className="w-6 h-6 shrink-0 text-primary" />
          <span className="font-bold text-lg hidden md:block truncate">
            Local<span className="text-primary">Notes</span>
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 md:p-4 space-y-2">
        <Button
          onClick={() => createNewNote()}
          className="w-full justify-center md:justify-start rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20"
        >
          <Plus className="w-5 h-5 md:mr-2" />
          <span className="hidden md:inline font-medium">New Note</span>
        </Button>

        <Button
          variant="ghost"
          onClick={onOpenCommandPalette}
          className="w-full justify-center md:justify-start text-sidebar-foreground hover:bg-sidebar-accent rounded-xl"
        >
          <Search className="w-5 h-5 md:mr-2" />
          <span className="hidden md:inline">Search</span>
          <kbd className="hidden lg:inline-flex ml-auto items-center gap-1 rounded border border-border bg-muted px-1.5 text-[10px] font-medium opacity-70">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto" />

      {/* Footer */}
      <div className="p-3 md:p-4 border-t border-sidebar-border/50 space-y-1">
        {/* Account info */}
        {user && (
          <div className="hidden md:flex items-center gap-2 px-2 py-2 mb-2 rounded-xl bg-sidebar-accent/50">
            <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0 uppercase">
              {user.email[0]}
            </div>
            <span className="text-xs text-sidebar-foreground truncate flex-1">{user.email}</span>
          </div>
        )}

        <div className="hidden md:flex items-center justify-between px-2 mb-2 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
          <span>{notes.length} Notes</span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={handleDisconnect}
              className="w-full justify-center md:justify-start text-sidebar-foreground hover:bg-sidebar-accent rounded-xl"
            >
              <Folder className="w-5 h-5 md:mr-2" />
              <span className="hidden md:inline text-sm">Close Vault</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Disconnect folder</TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          onClick={toggleTheme}
          className="w-full justify-center md:justify-start text-sidebar-foreground hover:bg-sidebar-accent rounded-xl"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5 md:mr-2" /> : <Moon className="w-5 h-5 md:mr-2" />}
          <span className="hidden md:inline text-sm">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="w-full justify-center md:justify-start text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive rounded-xl"
            >
              <LogOut className="w-5 h-5 md:mr-2" />
              <span className="hidden md:inline text-sm">Sign Out</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Sign out</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
