import "server-only";
import { createClient } from "@/lib/supabase/server";
import { moneyText } from "@/lib/domain/finance";
import type { ReportPeriod } from "@/lib/domain/reports";

/*
 * Management reports (0025), read AS THE SIGNED-IN USER. The database functions
 * check the role and the period; the page only decides which sections to ask for.
 * Money comes back as numeric(14,2) and is turned into 2-decimal strings here.
 */

function range(days: ReportPeriod) {
  const to = new Date();
  return { p_from: new Date(to.getTime() - days * 864e5).toISOString(), p_to: to.toISOString() };
}

export async function getOpsReports(days: ReportPeriod) {
  const supabase = await createClient();
  const p = range(days);
  const [dwell, transit, delivery] = await Promise.all([
    supabase.rpc("report_port_dwell", p),
    supabase.rpc("report_transit", p),
    supabase.rpc("report_delivery_performance", p),
  ]);
  const err = dwell.error ?? transit.error ?? delivery.error;
  if (err) throw new Error("Could not load the reports");
  return { dwell: dwell.data ?? [], transit: transit.data ?? [], delivery: delivery.data ?? [] };
}

export async function getOverdueInvoices() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_overdue_invoices");
  if (error) throw new Error("Could not load the overdue invoices");
  return (data ?? []).map((r) => ({
    ...r,
    days_1_30: moneyText(r.days_1_30), days_31_60: moneyText(r.days_31_60), days_61_90: moneyText(r.days_61_90),
    days_over_90: moneyText(r.days_over_90), total_overdue: moneyText(r.total_overdue),
  }));
}

export type OpsReports = Awaited<ReturnType<typeof getOpsReports>>;
export type OverdueRow = Awaited<ReturnType<typeof getOverdueInvoices>>[number];
