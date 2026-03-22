import { motion } from "framer-motion";
import { FolderOpen, HardDrive, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotesStore } from "@/lib/store";
import { isFileSystemSupported } from "@/lib/fileSystem";

export function WelcomeScreen() {
  const openNewVault = useNotesStore(state => state.openNewVault);

  return (
    <div className="min-h-screen w-full flex flex-col relative overflow-hidden bg-background">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
          alt="Hero background" 
          className="w-full h-full object-cover opacity-60 dark:opacity-30 mix-blend-overlay"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/95 to-background" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-2xl w-full space-y-12 text-center"
        >
          <div className="space-y-6">
            <div className="inline-flex items-center justify-center p-4 rounded-3xl bg-primary/10 text-primary mb-4 ring-1 ring-primary/20 shadow-2xl shadow-primary/20">
              <Zap className="w-12 h-12" strokeWidth={1.5} />
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground">
              Local<span className="text-primary">Notes</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-xl mx-auto font-light leading-relaxed">
              Your thoughts, your files. A beautiful markdown editor that works directly with your local folder.
            </p>
          </div>

          {!isFileSystemSupported ? (
            <div className="bg-destructive/10 text-destructive p-6 rounded-2xl border border-destructive/20 text-left max-w-lg mx-auto">
              <h3 className="font-bold flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5" /> Browser Not Supported
              </h3>
              <p className="text-sm opacity-90">
                Your browser doesn't support the File System Access API required for this app to work offline directly with your files. Please use Chrome, Edge, or a recent Chromium-based browser.
              </p>
            </div>
          ) : (
            <motion.div 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button 
                onClick={openNewVault}
                size="lg" 
                className="h-16 px-10 rounded-2xl text-lg font-medium shadow-xl shadow-primary/25 hover:shadow-primary/40 transition-all"
              >
                <FolderOpen className="mr-3 w-6 h-6" />
                Select Notes Folder
              </Button>
            </motion.div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12 max-w-3xl mx-auto">
            <Feature 
              icon={<HardDrive />}
              title="100% Local"
              description="Notes are saved as plain .md files on your hard drive."
            />
            <Feature 
              icon={<Shield />}
              title="Private by Design"
              description="No servers, no accounts, no telemetry. Pure privacy."
            />
            <Feature 
              icon={<Zap />}
              title="Blazing Fast"
              description="Offline-first architecture means instant loading times."
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Feature({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="flex flex-col items-center text-center space-y-3 p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50">
      <div className="p-3 rounded-full bg-secondary text-foreground">
        {icon}
      </div>
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
