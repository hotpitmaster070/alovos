"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

const COLORS = ["#E8D5B0", "#FFFFFF", "#7DD3A0", "#F5B971", "#9CC4FF"];
const PIECES = 90;

/** One burst from the top centre of the viewport; purely decorative. */
export default function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 900,
        y: 300 + Math.random() * 500,
        rotate: (Math.random() - 0.5) * 900,
        delay: Math.random() * 0.15,
        duration: 1.4 + Math.random() * 1.1,
        size: 6 + Math.random() * 6,
        round: i % 3 === 0,
        color: COLORS[i % COLORS.length],
      })),
    [],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((piece) => (
        <motion.span
          key={piece.id}
          className="absolute left-1/2 top-[18%] block"
          style={{
            width: piece.size,
            height: piece.round ? piece.size : piece.size * 0.45,
            borderRadius: piece.round ? "9999px" : "2px",
            backgroundColor: piece.color,
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: piece.x, y: [0, -140 - Math.random() * 120, piece.y], opacity: [1, 1, 0], rotate: piece.rotate, scale: 1 }}
          transition={{ duration: piece.duration, delay: piece.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
