"use client";

import { motion } from "framer-motion";
import { Brain, TrendingUp, Database, Zap, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: Brain,
    title: "AI-Powered Analytics",
    description: "Our machine learning models analyze thousands of data points including team form, player statistics, head-to-head records, and real-time match events to generate accurate predictions."
  },
  {
    icon: Database,
    title: "Comprehensive Data Coverage",
    description: "We track data from major leagues worldwide including Premier League, La Liga, Serie A, Bundesliga, Ligue 1, and Champions League, with historical data going back years."
  },
  {
    icon: TrendingUp,
    title: "Live Probability Updates",
    description: "Win probabilities are recalculated in real-time as matches progress, taking into account goals, cards, substitutions, and other match events."
  },
  {
    icon: Zap,
    title: "Real-Time Match Data",
    description: "Get instant updates on scores, match events, team lineups, and detailed statistics as matches unfold across all major competitions."
  }
];

const methodology = [
  {
    title: "Data Collection",
    description: "We aggregate data from multiple reliable sources including official league APIs, sports data providers, and verified statistics databases."
  },
  {
    title: "Feature Engineering", 
    description: "Raw data is processed into meaningful features like recent form, goal averages, defensive strength, and historical performance metrics."
  },
  {
    title: "Model Training",
    description: "Machine learning models are trained on historical match data using techniques like gradient boosting, neural networks, and ensemble methods."
  },
  {
    title: "Real-time Analysis",
    description: "During live matches, models continuously update predictions based on current match state, time remaining, and in-game events."
  }
];

export default function AboutPage() {
  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-primary/5 to-background py-16">
        <div className="container space-y-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-4"
          >
            <h1 className="text-4xl md:text-5xl font-bold">About ATHLETE</h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Advanced football analytics platform providing real-time match insights, 
              win probabilities, and comprehensive analysis powered by machine learning.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="container space-y-12">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-bold">What We Offer</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Comprehensive football analytics tools designed for fans, analysts, and enthusiasts
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.6 }}
            >
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <span>{feature.title}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Methodology */}
      <section className="bg-muted/30 py-16">
        <div className="container space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-bold">Our Methodology</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              How we generate accurate match predictions and analysis
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {methodology.map((step, index) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.1, duration: 0.6 }}
                className="text-center space-y-4"
              >
                <div className="w-12 h-12 mx-auto rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                  {index + 1}
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="container">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-4 py-8 border-t border-border/50"
        >
          <div className="flex items-center justify-center space-x-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Important Disclaimer</h3>
          </div>
          <p className="text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            All predictions and probabilities are statistical estimates based on historical data and current match conditions. 
            They should be used for informational and entertainment purposes only. Actual match outcomes may vary significantly 
            from predictions. Please gamble responsibly if using this information for betting purposes.
          </p>
        </motion.div>
      </section>
    </div>
  );
}