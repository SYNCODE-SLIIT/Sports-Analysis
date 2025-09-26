"use client";

import { motion } from "framer-motion";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SummaryResponse } from "@/lib/api";

interface SummaryCardProps {
  summary: SummaryResponse;
  className?: string;
}

export function SummaryCard({ summary, className }: SummaryCardProps) {
  const { headline, summary: summaryText, bullets } = summary;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className={className}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5 text-primary" />
            <span>Match Summary</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {headline && (
            <div>
              <h4 className="font-semibold text-lg leading-tight">
                {headline}
              </h4>
            </div>
          )}

          {summaryText && (
            <div>
              <p className="text-muted-foreground leading-relaxed">
                {summaryText}
              </p>
            </div>
          )}

          {bullets && bullets.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-medium text-sm">Key Points:</h5>
              <ul className="space-y-1">
                {bullets.map((bullet, index) => (
                  <motion.li
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className="text-sm text-muted-foreground flex items-start space-x-2"
                  >
                    <span className="text-primary mt-1">•</span>
                    <span>{bullet}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}