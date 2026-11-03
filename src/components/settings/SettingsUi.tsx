/**
 * Stavební prvky stránky Nastavení: karta se skupinou řádků, řádek s popisem
 * a ovládacím prvkem vpravo a přepínač zapnuto / vypnuto.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Atributy data-settings-* používá hledání v Nastavení (SettingsSearch) – karta, její nadpis a řádky. */
export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section data-settings-card className={cn("mb-6 rounded-2xl border border-line bg-surface p-2 shadow-card", className)}>
      {title && (
        <h2 data-settings-title className="px-4 pt-3 pb-1 text-sm font-semibold tracking-wide text-muted uppercase">
          {title}
        </h2>
      )}
      <div data-settings-body className="divide-y divide-line">
        {children}
      </div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  children?: ReactNode;
  /** Řádek je jen pro informaci (závislá volba je vypnutá) – ztlumený. */
  disabled?: boolean;
}) {
  return (
    <div data-settings-row className={cn("flex items-center justify-between gap-6 px-4 py-3.5", disabled && "opacity-50")}>
      <div className="min-w-0">
        {label && <p className="text-sm font-medium">{label}</p>}
        {hint && <div className="mt-0.5 max-w-md text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Jednoduchý přepínač zapnuto / vypnuto. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Řádek s přepínačem – nejčastější prvek předvoleb. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint} disabled={disabled}>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </Row>
  );
}
