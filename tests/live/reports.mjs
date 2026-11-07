// Management reports against the dev project (0025, US-12): who can see them, and that the
// numbers agree with the underlying records. Read-only: creates no data.
import { check, finish, get, login, pageText, svc } from "./_shared.mjs";

console.log("Reports:");
const ops = await login("ops.manager@ngb.example");
const finance = await login("finance@ngb.example");
const doc = await login("doc.officer@ngb.example");
const aline = await login("aline@akagera.example");
const html = async (path, who) => pageText(await get(path, who));
const SECTIONS = ["Port dwell time", "Transit duration", "Delivery performance", "Overdue invoices"];

const opsPage = await html("/admin/reports?period=30", ops);
check("ops manager sees all four reports", SECTIONS.every((s) => opsPage.includes(s)));
check("admin nav shows Reports to the ops manager", (await html("/admin", ops)).includes(">Reports<"));
const finPage = await html("/admin/reports", finance);
check("finance sees overdue invoices only", finPage.includes("Overdue invoices") && !finPage.includes("Port dwell time"));
check("doc officer gets no reports", !(await html("/admin/reports", doc)).includes("Overdue invoices") && !(await html("/admin", doc)).includes(">Reports<"));
check("client opening /admin/reports → /portal", ((await get("/admin/reports", aline)).headers.get("location") ?? "").endsWith("/portal"));
check("an unknown period falls back to 90 days", (await html("/admin/reports?period=9999", ops)).includes('aria-current="page"'));

const to = new Date(), from = new Date(to.getTime() - 30 * 864e5);
const P = { p_from: from.toISOString(), p_to: to.toISOString() };
for (const fn of ["report_port_dwell", "report_transit", "report_delivery_performance"]) {
  const c = await aline.api.rpc(fn, P), f = await finance.api.rpc(fn, P);
  check(`${fn}: refused to clients and finance`, c.error?.code === "42501" && f.error?.code === "42501");
}
check("overdue invoices refused to clients", (await aline.api.rpc("report_overdue_invoices")).error?.code === "42501");

// numbers agree with the records (service role, same rules)
const { data: dwell } = await ops.api.rpc("report_port_dwell", P);
const { data: gated } = await svc.from("containers").select("id, discharge_at, gate_out_at, shipment:shipments!inner(overall_status)")
  .gte("gate_out_at", P.p_from).lt("gate_out_at", P.p_to).not("discharge_at", "is", null).neq("shipment.overall_status", "draft");
const expectGated = (gated ?? []).filter((c) => c.gate_out_at >= c.discharge_at).length;
check(`dwell counts every container gated out in 30 days (${expectGated})`, (dwell ?? []).reduce((t, r) => t + r.containers, 0) === expectGated);
const { data: transit } = await ops.api.rpc("report_transit", P);
const { data: delivered } = await svc.from("containers").select("gate_out_at, delivery_at, shipment:shipments!inner(overall_status)")
  .gte("delivery_at", P.p_from).lt("delivery_at", P.p_to).not("gate_out_at", "is", null).neq("shipment.overall_status", "draft");
const expectDelivered = (delivered ?? []).filter((c) => c.delivery_at >= c.gate_out_at).length;
check(`transit counts every container delivered in 30 days (${expectDelivered})`, (transit ?? []).reduce((t, r) => t + r.containers, 0) === expectDelivered);
const { data: perf } = await ops.api.rpc("report_delivery_performance", P);
check("delivery performance: on time + late = delivered for every client", (perf ?? []).every((r) => r.on_time + r.late === r.delivered));

const { data: od } = await finance.api.rpc("report_overdue_invoices");
const { data: inv } = await svc.from("invoices").select("balance_due, due_date, status, client:organizations!invoices_client_id_fkey(timezone)")
  .in("status", ["issued", "partially_paid", "overdue", "disputed"]).gt("balance_due", 0);
const today = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "Africa/Kigali" }).format(new Date());
const pastDue = (inv ?? []).filter((i) => i.due_date < today(i.client?.timezone));
check(`overdue invoices: every past-due invoice counted (${pastDue.length})`, (od ?? []).reduce((t, r) => t + r.invoices, 0) === pastDue.length);
const cents = (v) => Math.round(Number(v) * 100);
check("overdue invoices: ageing buckets add up to the total", (od ?? []).every((r) =>
  cents(r.total_overdue) === cents(r.days_1_30) + cents(r.days_31_60) + cents(r.days_61_90) + cents(r.days_over_90)));

finish();
