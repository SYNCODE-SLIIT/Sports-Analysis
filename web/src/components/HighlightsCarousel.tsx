"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Highlight } from "@/lib/schemas";
import { ASSETS } from "@/lib/assets";

interface HighlightsCarouselProps {
  highlights: Highlight[];
  isLoading?: boolean;
  className?: string;
}

function HighlightCard({ highlight, index }: { highlight: Highlight; index: number }) {
  const thumbnail = highlight.thumbnail || ASSETS.placeholders.thumb;
  const title = highlight.title || "Football Highlight";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className="flex-shrink-0 w-80"
    >
      <Card className="overflow-hidden hover:shadow-lg transition-all duration-200 group">
        <CardContent className="p-0">
          <div className="relative">
            <Image
              src={thumbnail}
              alt={title}
              width={320}
              height={180}
              className="w-full h-48 object-cover"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
              <Button size="sm" variant="secondary" asChild>
                {highlight.url ? (
                  <Link href={highlight.url} target="_blank" rel="noopener noreferrer">
                    <Play className="h-4 w-4 mr-2" />
                    Watch
                    <ExternalLink className="h-3 w-3 ml-2" />
                  </Link>
                ) : (
                  <span>
                    <Play className="h-4 w-4 mr-2" />
                    Watch
                  </span>
                )}
              </Button>
            </div>
            
            {highlight.duration && (
              <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                {Math.floor(highlight.duration / 60)}:
                {String(highlight.duration % 60).padStart(2, '0')}
              </div>
            )}
          </div>
          
          <div className="p-4 space-y-2">
            <h4 className="font-medium line-clamp-2 group-hover:text-primary transition-colors">
              {title}
            </h4>
            
            {highlight.provider && (
              <p className="text-xs text-muted-foreground">
                via {highlight.provider}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function HighlightsCarousel({ 
  highlights, 
  isLoading, 
  className 
}: HighlightsCarouselProps) {
  if (isLoading) {
    return (
      <div className={className}>
        <ScrollArea className="w-full">
          <div className="flex space-x-4 pb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-80 h-48 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    );
  }

  if (!highlights.length) {
    return (
      <div className={className}>
        <div className="text-center py-8 text-muted-foreground">
          No highlights available
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <ScrollArea className="w-full">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex space-x-4 pb-4"
        >
          {highlights.map((highlight, index) => (
            <HighlightCard
              key={highlight.id}
              highlight={highlight}
              index={index}
            />
          ))}
        </motion.div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}