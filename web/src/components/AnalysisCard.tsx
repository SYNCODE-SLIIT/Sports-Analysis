"use client";

import { motion } from "framer-motion";
import { TrendingUp, Clock, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MatchInsights } from "@/lib/schemas";

interface AnalysisCardProps {
  insights: MatchInsights;
  className?: string;
}

export function AnalysisCard({ insights, className }: AnalysisCardProps) {
  const { winprob, meta } = insights;

  if (!winprob) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="text-center text-muted-foreground">
            <Info className="h-8 w-8 mx-auto mb-2" />
            <p>No analysis data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const probabilities = [
    { label: "Home Win", value: winprob.home, color: "bg-green-500" },
    { label: "Draw", value: winprob.draw, color: "bg-yellow-500" },
    { label: "Away Win", value: winprob.away, color: "bg-blue-500" },
  ].filter(p => p.value !== undefined);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={className}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span>Match Analysis</span>
          </CardTitle>
          {winprob.method && (
            <Badge variant="outline" className="w-fit">
              {winprob.method}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Win Probabilities */}
          <div className="space-y-4">
            <h4 className="font-medium">Win Probabilities</h4>
            {probabilities.map((prob, index) => (
              <motion.div
                key={prob.label}
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ delay: index * 0.1, duration: 0.8 }}
                className="space-y-2"
              >
                <div className="flex justify-between text-sm">
                  <span>{prob.label}</span>
                  <span className="font-medium">
                    {Math.round((prob.value || 0) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(prob.value || 0) * 100}%` }}
                    transition={{ delay: index * 0.1 + 0.2, duration: 1, ease: "easeOut" }}
                    className={`h-full ${prob.color} rounded-full`}
                  />
                </div>
              </motion.div>
            ))}
          </div>

          {/* Explanation */}
          {winprob.explain && (
            <div className="space-y-2">
              <h4 className="font-medium">Explanation</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {winprob.explain}
              </p>
            </div>
          )}

          {/* Metadata */}
          {meta?.generated_at && (
            <div className="pt-4 border-t border-border/50">
              <div className="flex items-center text-xs text-muted-foreground space-x-1">
                <Clock className="h-3 w-3" />
                <span>
                  Generated: {new Date(meta.generated_at).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}