import { motion } from "motion/react";
import { useMemo } from "react";
import { BANNER_ICONS } from "@/data/bannerIcons";
import { hashString } from "@/lib/utils";
import type { CategoryId } from "@/types";

/** Deterministický generátor náhodných čísel – stejný klíč = stejný vzorek. */
function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

interface DoodlesProps {
  /** Klíč, ze kterého se odvodí rozmístění (např. id aplikace). */
  seedKey: string;
  category?: CategoryId;
  ink: string;
  cols?: number;
  rows?: number;
  opacity?: number;
}

/**
 * Dekorativní vzorek obrysových ikon podle kategorie (jako „doodle“ pozadí
 * bannerů v App Store). Mřížka s náhodným posunem, velikostí a natočením.
 */
export function Doodles({ seedKey, category = "utilities", ink, cols = 9, rows = 3, opacity = 0.16 }: DoodlesProps) {
  const items = useMemo(() => {
    const icons = BANNER_ICONS[category];
    const rand = seeded(hashString(seedKey) + 7);
    return Array.from({ length: cols * rows }, (_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        Icon: icons[(i * 5 + Math.floor(rand() * icons.length)) % icons.length],
        left: ((col + 0.5 + (rand() - 0.5) * 0.6) / cols) * 100,
        top: ((row + 0.5 + (rand() - 0.5) * 0.5) / rows) * 100,
        size: 54 + rand() * 46,
        rotate: (rand() - 0.5) * 50,
      };
    });
  }, [seedKey, category, cols, rows]);

  return (
    <motion.div
      aria-hidden
      // Jen dekorace – kliky propouští kartě pod sebou
      className="pointer-events-none absolute inset-0"
      initial={{ scale: 1.08, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {items.map(({ Icon, left, top, size, rotate }, i) => (
        <Icon
          key={i}
          strokeWidth={1.6}
          className="absolute"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: size,
            height: size,
            color: ink,
            // --pattern-boost: karta může vzorek v jednom tématu zesílit (ProfileCollections)
            opacity: `calc(${opacity} * var(--pattern-boost, 1))`,
            transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
          }}
        />
      ))}
    </motion.div>
  );
}
