"use client";

import { motion } from "framer-motion";
import { Heart, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";

export default function MyTeamsPage() {
  // TODO: Connect to real authentication system
  const isAuthenticated = false;

  if (!isAuthenticated) {
    return (
      <div className="container py-8 min-h-[60vh] flex items-center justify-center">
        <EmptyState
          type="no-teams"
          title="Sign in to manage your teams"
          description="Create an account or sign in to save your favorite teams and get personalized match recommendations."
          actionLabel="Sign In"
          onAction={() => window.location.href = '/auth/login'}
        />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-start"
      >
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <Heart className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">My Teams</h1>
          </div>
          <p className="text-muted-foreground">
            Manage your favorite teams and get personalized match updates and analysis.
          </p>
        </div>
        
        <Button className="flex items-center space-x-2">
          <Plus className="h-4 w-4" />
          <span>Add Team</span>
        </Button>
      </motion.div>

      {/* Content would go here when authenticated */}
      <Card>
        <CardHeader>
          <CardTitle>Your Favorite Teams</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            type="no-teams"
            description="You haven&apos;t added any favorite teams yet. Browse leagues to discover teams and add them to your favorites."
            actionLabel="Browse Teams"
            onAction={() => window.location.href = '/leagues'}
          />
        </CardContent>
      </Card>
    </div>
  );
}