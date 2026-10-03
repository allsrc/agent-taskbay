"use client";

import { motion } from "motion/react";

/** Re-mounts on every navigation, giving each screen a short fade-and-rise entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
