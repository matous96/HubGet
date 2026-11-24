import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "accentGhost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 shadow-sm shadow-accent/30",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3 border border-line",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  /** Bez pozadí v barvě zvýraznění (mráček Nainstalovat znovu). */
  accentGhost: "text-accent hover:bg-accent/12",
  danger: "bg-danger/10 text-danger hover:bg-danger/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-sm gap-2",
};

/** Základní tlačítko se zaoblením ve tvaru „pilulky“. */
export function Button({ variant = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold whitespace-nowrap",
        "transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
}

/** Kulaté tlačítko pouze s ikonou. */
export function IconButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted",
        "transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...rest}
    />
  );
}
