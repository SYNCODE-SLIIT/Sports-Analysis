"use client";

import { motion } from "framer-motion";
import { AlertCircle, Calendar, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  type?: "no-data" | "error" | "no-matches" | "no-teams";
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const icons = {
  "no-data": Search,
  "error": AlertCircle,
  "no-matches": Calendar,
  "no-teams": Users,
};

const defaults = {
  "no-data": {
    title: "No data available",
    description: "We couldn't find any data to display at the moment.",
  },
  "error": {
    title: "Something went wrong",
    description: "An error occurred while loading the data. Please try again.",
    actionLabel: "Retry",
  },
  "no-matches": {
    title: "No matches found",
    description: "There are no matches scheduled for the selected criteria.",
  },
  "no-teams": {
    title: "No teams selected",
    description: "Add some teams to your favorites to see personalized content.",
    actionLabel: "Browse Teams",
  },
};

export function EmptyState({ 
  type = "no-data", 
  title, 
  description, 
  actionLabel, 
  onAction 
}: EmptyStateProps) {
  const Icon = icons[type];
  const defaultConfig = defaults[type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center py-12 px-4 text-center space-y-4"
    >
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>
      
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">
          {title || defaultConfig.title}
        </h3>
        <p className="text-muted-foreground max-w-md">
          {description || defaultConfig.description}
        </p>
      </div>

      {((actionLabel || ('actionLabel' in defaultConfig && defaultConfig.actionLabel)) && onAction) && (
        <Button onClick={onAction} variant="outline">
          {actionLabel || ('actionLabel' in defaultConfig ? defaultConfig.actionLabel : '')}
        </Button>
      )}
    </motion.div>
  );
}