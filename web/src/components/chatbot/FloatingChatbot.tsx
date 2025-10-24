"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, LogIn } from "lucide-react";
import Image from "next/image";
import { ChatbotPanel } from "./ChatbotPanel";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { usePlanContext } from "@/components/PlanProvider";
import { useRouter } from "next/navigation";

export function FloatingChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { user } = useAuth();
  const { plan } = usePlanContext();
  const router = useRouter();
  const isAdminRoute = pathname?.startsWith("/admin");

  // Don't show on login/signup pages
  if (pathname?.startsWith("/auth/") || isAdminRoute) {
    return null;
  }

  const handleUpgradeRedirect = () => {
    setIsOpen(false);
    router.push("/pro");
  };

  return (
    <>
      {/* Floating Button */}
      <motion.button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-12 right-16 z-40 h-20 w-20 rounded-full shadow-2xl flex items-center justify-center bg-white dark:bg-black border-2 border-primary/20 hover:border-primary/40 transition-all duration-300 hover:scale-110"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.5 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Open chatbot"
      >
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatType: "reverse",
          }}
        >
          <Image
            src="/logo/chatbot.svg"
            alt="Chatbot"
            width={44}
            height={44}
            className="h-11 w-11"
          />
        </motion.div>
        
        {/* Pulse animation ring */}
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-primary"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatType: "loop",
          }}
        />
      </motion.button>

      {/* Chatbot Popup */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            />
            
            {/* Popup Panel */}
            <motion.div
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-6 top-8 bottom-8 z-50 w-full sm:w-[640px] md:w-[740px] bg-background border shadow-2xl rounded-2xl overflow-hidden"
            >
              <div className="h-full flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-primary/5 to-transparent backdrop-blur rounded-t-2xl">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center ring-2 ring-primary/20">
                      <Image
                        src="/logo/chatbot.svg"
                        alt="Chatbot"
                        width={24}
                        height={24}
                        className="h-6 w-6"
                      />
                    </div>
                    <div>
                      <h2 className="text-base font-bold">ATHLETE AI</h2>
                      <p className="text-xs text-muted-foreground">
                        Your intelligent sports analysis assistant
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => setIsOpen(false)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    aria-label="Close chatbot"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>

                {/* Chatbot Panel or Sign In Message */}
                <div className="flex-1 overflow-hidden p-3">
                  <div className="h-full">
                    {user ? (
                      plan === "pro" ? (
                        <ChatbotPanel />
                      ) : (
                        <div className="h-full flex items-center justify-center">
                          <div className="text-center space-y-4 max-w-sm px-6">
                            <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                              <Image
                                src="/logo/chatbot.svg"
                                alt="Chatbot Locked"
                                width={32}
                                height={32}
                                className="h-8 w-8"
                              />
                            </div>
                            <h3 className="text-xl font-bold">Upgrade to chat with ATHLETE AI</h3>
                            <p className="text-sm text-muted-foreground">
                              Start a 7-day free trial of Sports Analysis Pro to unlock our AI assistant for game plans,
                              stats, and predictions.
                            </p>
                            <Button className="mt-2" onClick={handleUpgradeRedirect}>
                              Upgrade to Pro
                            </Button>
                          </div>
                        </div>
                      )
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center space-y-4 max-w-sm px-6">
                          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                            <LogIn className="h-8 w-8 text-primary" />
                          </div>
                          <h3 className="text-xl font-bold">Sign in to use ATHLETE AI</h3>
                          <p className="text-sm text-muted-foreground">
                            Get instant answers to your sports questions, powered by advanced AI and live web sources.
                          </p>
                          <Button 
                            className="mt-4" 
                            onClick={() => {
                              setIsOpen(false);
                              window.location.href = '/auth/login';
                            }}
                          >
                            <LogIn className="h-4 w-4 mr-2" />
                            Sign In
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
