"use client";

import { motion } from "framer-motion";

type Plan = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  badge?: string;
  cta?: {
    priceId: string;
    label: string;
  } | null;
};

type Props = {
  plans: Plan[];
};

export function ProPlanCompare({ plans }: Props) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/10 to-transparent" />
      <div className="relative grid gap-6 p-6 md:grid-cols-3">
        {plans.map((plan, index) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.4 }}
            viewport={{ once: true, amount: 0.3 }}
            className="rounded-xl border border-border/60 bg-background/80 p-5 backdrop-blur"
          >
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {plan.name} plan
              </p>
              <p className="text-3xl font-semibold">
                {plan.price}
                <span className="ml-2 text-base font-normal text-muted-foreground">{plan.cadence}</span>
              </p>
              <p className="text-sm text-muted-foreground">{plan.description}</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {plan.features.slice(0, 4).map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {feature}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
