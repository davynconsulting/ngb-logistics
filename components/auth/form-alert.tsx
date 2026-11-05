import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const styles = {
  error: { icon: CircleAlert, className: "border-destructive/30 bg-destructive/10 text-destructive" },
  success: { icon: CircleCheck, className: "border-success/30 bg-success/10 text-success" },
  info: { icon: Info, className: "border-info/30 bg-info/10 text-info" },
} as const;

/** Inline message shown above a form. Announced to screen readers. */
export function FormAlert({ kind, children }: { kind: keyof typeof styles; children: React.ReactNode }) {
  const { icon: Icon, className } = styles[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn("flex gap-2 rounded-md border px-3 py-2 text-sm", className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
