// Small reusable UI primitives, shared across panels.
// Keeps Tailwind class strings in one place so panels stay readable.

import type { ReactNode } from "react";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const INPUT_CLS =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={INPUT_CLS + " " + (props.className ?? "")} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={INPUT_CLS + " " + (props.className ?? "")} />;
}

type ButtonVariant = "primary" | "ghost" | "danger" | "small" | "smallDanger";

const BUTTON_CLS: Record<ButtonVariant, string> = {
  primary:
    "rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800",
  ghost:
    "rounded-lg border border-indigo-700 bg-white px-3.5 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50",
  danger:
    "rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700",
  small:
    "rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100",
  smallDanger:
    "rounded-lg bg-red-50 px-3 py-1.5 text-sm font-bold text-red-600 hover:bg-red-100",
};

export function Button({
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button {...rest} className={BUTTON_CLS[variant] + " " + (className ?? "")} />
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
      {text}
    </div>
  );
}

type PillTone = "good" | "warn" | "info";

const PILL_CLS: Record<PillTone, string> = {
  good: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  info: "bg-indigo-100 text-indigo-800",
};

export function Pill({
  tone = "info",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "rounded-full px-2.5 py-1 text-xs font-bold " + PILL_CLS[tone]
      }
    >
      {children}
    </span>
  );
}

export function SectionCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      {children}
    </div>
  );
}
