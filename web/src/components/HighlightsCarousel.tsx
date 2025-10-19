"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { ExternalLink, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Highlight } from "@/lib/schemas";
import { ASSETS } from "@/lib/assets";

interface HighlightsCarouselProps {
  highlights: Highlight[];
  isLoading?: boolean;
  className?: string;
}

function HighlightCard({
  highlight,
  index,
  onOpen,
}: {
  highlight: Highlight;
  index: number;
  onOpen: (highlight: Highlight) => void;
}) {
  const thumbnail = highlight.thumbnail || ASSETS.placeholders.thumb;
  const title = highlight.title || "Football Highlight";
  const disabled = !highlight.url;

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
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={() => !disabled && onOpen(highlight)}
              >
                <Play className="h-4 w-4 mr-2" />
                Watch
                {!disabled && <ExternalLink className="h-3 w-3 ml-2" />}
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
  const [active, setActive] = useState<Highlight | null>(null);
  const [open, setOpen] = useState(false);

  const embed = useMemo(() => {
    if (!active || !active.url) return null;
    const url = active.url;
    const lower = url.toLowerCase();
    const isYouTube = lower.includes("youtube.com/watch") || lower.includes("youtu.be/");
    if (isYouTube) {
      const queryMatch = url.match(/[?&]v=([^&]+)/);
      const shortMatch = url.match(/youtu\.be\/([^?]+)/);
      const videoId = queryMatch?.[1] || shortMatch?.[1];
      if (videoId) {
        return { type: "youtube" as const, src: `https://www.youtube.com/embed/${videoId}?autoplay=1` };
      }
    }
    const isMp4 = /\.mp4($|\?)/.test(lower);
    if (isMp4) {
      return { type: "mp4" as const, src: url };
    }
    return { type: "iframe" as const, src: url };
  }, [active]);

  const closePlayer = () => {
    setOpen(false);
    setActive(null);
  };

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
              onOpen={(item) => {
                setActive(item);
                setOpen(true);
              }}
            />
          ))}
        </motion.div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <Dialog open={open} onOpenChange={(next) => (!next ? closePlayer() : setOpen(next))}>
        <DialogContent className="max-w-4xl w-[90vw] p-0 overflow-hidden" showCloseButton>
          {active && (
            <>
              <DialogHeader className="px-6 pt-6 pb-2">
                <DialogTitle>{active.title || "Match Highlight"}</DialogTitle>
              </DialogHeader>
              <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
                {embed?.type === "youtube" && (
                  <iframe
                    key={embed.src}
                    src={embed.src}
                    className="absolute inset-0 h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    title={active.title || "Match highlight"}
                  />
                )}
                {embed?.type === "mp4" && (
                  <video
                    key={embed.src}
                    src={embed.src}
                    className="absolute inset-0 h-full w-full"
                    controls
                    autoPlay
                  />
                )}
                {embed?.type === "iframe" && (
                  <iframe
                    key={embed.src}
                    src={embed.src}
                    className="absolute inset-0 h-full w-full"
                    allowFullScreen
                    title={active.title || "Match highlight"}
                  />
                )}
                {!embed && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background">
                    <p className="text-sm text-muted-foreground">
                      Unable to load this highlight.
                    </p>
                  </div>
                )}
              </div>
              {active.provider && (
                <div className="px-6 py-3 text-xs text-muted-foreground">
                  Source: {active.provider}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}