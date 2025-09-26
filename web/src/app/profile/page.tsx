"use client";

import { motion } from "framer-motion";
import { User, Settings, Trophy, Clock, Heart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";

// TODO: Connect to real authentication system
const isAuthenticated = false;

// Mock user data - replace with real user data from auth context
const userData = {
  name: "John Doe",
  email: "john.doe@email.com",
  joinDate: "2024-01-15",
  favoriteTeams: ["Manchester United", "Barcelona", "AC Milan"],
  stats: {
    matchesFollowed: 247,
    predictionsCorrect: 156,
    accuracy: 63
  },
  recentActivity: [
    { match: "Arsenal vs Chelsea", prediction: "Arsenal Win", result: "correct", date: "2024-01-20" },
    { match: "Barcelona vs Real Madrid", prediction: "Draw", result: "incorrect", date: "2024-01-19" },
    { match: "Man City vs Liverpool", prediction: "Man City Win", result: "correct", date: "2024-01-18" }
  ]
};

export default function ProfilePage() {
  if (!isAuthenticated) {
    return (
      <div className="container py-16">
        <EmptyState
          type="no-teams"
          title="Login Required"
          description="Please login to view your profile and track your predictions"
          actionLabel="Go to Login"
          onAction={() => window.location.href = "/auth/login"}
        />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Profile Header */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                <User className="w-8 h-8 text-primary-foreground" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold">{userData.name}</h1>
                <p className="text-muted-foreground">{userData.email}</p>
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>Member since {new Date(userData.joinDate).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="md:ml-auto">
                <Button variant="outline" size="sm">
                  <Settings className="w-4 h-4 mr-2" />
                  Edit Profile
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Matches Followed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{userData.stats.matchesFollowed}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Correct Predictions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{userData.stats.predictionsCorrect}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Accuracy Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{userData.stats.accuracy}%</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Favorite Teams */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Heart className="w-5 h-5 text-red-500" />
              <span>Favorite Teams</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {userData.favoriteTeams.map((team) => (
                <Badge key={team} variant="secondary" className="px-3 py-1">
                  {team}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Trophy className="w-5 h-5" />
              <span>Recent Predictions</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {userData.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
                  <div className="space-y-1">
                    <div className="font-medium">{activity.match}</div>
                    <div className="text-sm text-muted-foreground">
                      Predicted: {activity.prediction}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Badge 
                      variant={activity.result === "correct" ? "default" : "destructive"}
                      className="capitalize"
                    >
                      {activity.result}
                    </Badge>
                    <div className="text-sm text-muted-foreground">
                      {new Date(activity.date).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}