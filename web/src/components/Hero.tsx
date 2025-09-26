"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ASSETS } from "@/lib/assets";

const textVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.3,
    }
  }
};

export function Hero() {
  return (
    <section className="relative min-h-[70vh] flex items-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src={ASSETS.hero}
          alt="Football stadium background"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/60 to-background/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 container">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-8"
          >
            <motion.div variants={textVariants} className="space-y-4">
              <h1 className="text-4xl md:text-6xl font-bold leading-tight">
                <span className="block">Live Football</span>
                <span className="block text-gradient">
                  Analytics & Insights
                </span>
              </h1>
              
              <p className="text-lg text-muted-foreground max-w-lg">
                Get real-time match probabilities, detailed analysis, and live updates 
                from the world&apos;s biggest football leagues.
              </p>
            </motion.div>

            <motion.div
              variants={textVariants}
              className="flex flex-col sm:flex-row gap-4"
            >
              <Button size="lg" asChild className="group">
                <Link href="/live">
                  <Play className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                  Explore Live
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              
              <Button variant="outline" size="lg" asChild>
                <Link href="/leagues">
                  Browse Leagues
                </Link>
              </Button>
            </motion.div>
          </motion.div>

          {/* Featured Content Placeholder - This would show a featured match */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="lg:flex justify-center hidden"
          >
            <div className="w-full max-w-md">
              {/* Featured match card would go here */}
              <div className="glass-bg p-6 rounded-2xl border shadow-xl">
                <div className="text-center space-y-4">
                  <h3 className="font-semibold text-lg">Featured Match</h3>
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">Loading...</div>
                  </div>
                  <Button variant="ghost" size="sm">
                    View Analysis
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}