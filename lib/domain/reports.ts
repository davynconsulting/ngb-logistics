import type { AppRole } from "@/lib/auth/roles";
import { FINANCE_READERS } from "@/lib/domain/finance";

/** Operational reports (dwell, transit, delivery): admin and operations managers (0025 checks again). */
export const OPS_REPORT_ROLES = ["admin", "ops_manager"] as const satisfies readonly AppRole[];
export const REPORT_ROLES = FINANCE_READERS;
export const canSeeOpsReports = (r: AppRole) => (OPS_REPORT_ROLES as readonly AppRole[]).includes(r);

export const REPORT_PERIODS = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number]["days"];
export function parsePeriod(v: unknown): ReportPeriod {
  const n = Number(v);
  return REPORT_PERIODS.find((p) => p.days === n)?.days ?? 90;
}

/** "80 h (3.3 d)": hours with one decimal, days added from 48 h. */
export function formatHours(h: number | string | null | undefined): string {
  if (h == null || h === "") return "—";
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  const hours = `${n.toFixed(1).replace(/\.0$/, "")} h`;
  return n >= 48 ? `${hours} (${(n / 24).toFixed(1)} d)` : hours;
}

/** Whole-number share, "–" when there is nothing to measure. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}
