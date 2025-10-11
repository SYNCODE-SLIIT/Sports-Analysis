"use client";

import { motion } from "framer-motion";
import { Brain, TrendingUp, Database, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface InfoSpotlightProps {
  className?: string;
}

const features = [
  {
    icon: Brain,
    title: "AI-Powered Analysis",
    description: "Advanced machine learning models analyze team performance, player statistics, and historical data."
  },
  {
    icon: TrendingUp,
    title: "Real-Time Probabilities",
    description: "Live win probability calculations updated throughout the match based on current game state."
  },
  {
    icon: Database,
    title: "Comprehensive Data",
    description: "Extensive database covering major leagues, teams, players, and match statistics."
  },
  {
    icon: Zap,
    title: "Instant Updates",
    description: "Get live scores, match events, and probability updates as they happen."
  }
];

export function InfoSpotlight({ className }: InfoSpotlightProps) {
  return (
    <div className={className}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="space-y-6"
      >
        <div className="text-center space-y-4">
          <h2 className="text-2xl md:text-3xl font-bold">
            How We Estimate
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Our advanced analytics platform combines multiple data sources and machine learning 
            models to provide accurate match predictions and insights.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + index * 0.1, duration: 0.6 }}
            >
              <Card className="h-full hover:shadow-lg transition-all duration-200 border-2 hover:border-primary/20">
                <CardHeader className="text-center pb-2">
                  <div className="w-12 h-12 mx-auto mb-2 rounded-lg bg-primary/10 flex items-center justify-center">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground text-center leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="text-center pt-6"
        >
          <p className="text-sm text-muted-foreground">
            <strong>Important:</strong> All predictions are estimates based on available data 
            and should be used for informational purposes only.
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}