// Finance admin screens against the dev project (0021): invoices, payments, verification, credit notes,
// disputes, void, receipts. Registers one fictional test shipment and invoices it per run.
import { check, cn, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("Finance:");
const stamp = Date.now().toString().slice(-6);

const finance = await login("finance@ngb.example");
const admin = await login("admin@ngb.example");
const ops = await login("ops.manager@ngb.example");
const doc = await login("doc.officer@ngb.example");
const aline = await login("aline@akagera.example");
const { data: akagera } = await svc.from("organizations").select("id, billing_terms_days").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();

// ---- fixture: a shipment to invoice ----
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLFIN${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", cargo_description: "Finance test cargo: roofing sheets (fictional)" },
  p_containers: [{ container_number: cn(700000 + (+stamp % 99999)), size_type: "40HC" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const shipId = reg.data[0].shipment_id;
const { data: ship } = await svc.from("shipments").select("shipment_reference").eq("id", shipId).single();
console.log(`fixture: ${ship.shipment_reference}\n`);

const loc = async (path, who) => (await get(path, who)).headers.get("location") ?? "";
const html = async (path, who) => pageText(await get(path, who));
const invoicesOf = async () => (await svc.from("invoices").select("id, status, invoice_number, subtotal, tax_total, total, amount_paid, amount_credited, balance_due, issue_date, due_date")
  .eq("shipment_id", shipId).order("created_at")).data ?? [];
const NEW = "/admin/finance/invoices/new";
const lines = (l) => JSON.stringify(l);
const LINES = [
  { description: "Port handling, Dar es Salaam (TEST)", quantity: "2", unit_price: "150.25", tax_rate: "18" },
  { description: "Road transport Dar–Kigali (TEST)", quantity: "1", unit_price: "2400.00", tax_rate: "0" },
];

// ---- access ----
check("finance opens /admin/finance", (await html("/admin/finance", finance)).includes("Invoices, payments and balances"));
check("ops manager opens /admin/finance", (await html("/admin/finance", ops)).includes("Invoices, payments and balances"));
check("admin nav shows Finance to finance, not to the doc officer",
  (await html("/admin", finance)).includes(">Finance<") && !(await html("/admin", doc)).includes(">Finance<"));
const docFin = await html("/admin/finance", doc);
check("doc officer gets no finance page", !docFin.includes("Invoices, payments and balances"));
check("client opening /admin/finance → /portal", (await loc("/admin/finance", aline)).endsWith("/portal"));
check("client cannot read invoices directly", ((await aline.api.from("invoices").select("id")).data ?? []).length === 0);

// ---- drafts ----
let r = await formAction(doc, "saveInvoiceDraft", [null, undefined],
  { shipment_id: shipId, currency: "USD", lines: lines(LINES) }, NEW);
check("doc officer cannot create a draft", (await invoicesOf()).length === 0, JSON.stringify(r.value));
r = await formAction(finance, "saveInvoiceDraft", [null, undefined],
  { shipment_id: shipId, currency: "USD", lines: lines([{ ...LINES[0], unit_price: "1.005" }]) }, NEW);
check("price with 3 decimals is refused in the form", !!r.value?.fieldErrors && (await invoicesOf()).length === 0, JSON.stringify(r.value));
r = await formAction(finance, "saveInvoiceDraft", [null, undefined],
  { shipment_id: shipId, currency: "USD", lines: lines(LINES), client_note: "Thank you for your business (TEST)" }, NEW);
let [inv] = await invoicesOf();
check("finance creates a draft and is sent to it", !!inv && (r.redirect ?? "").includes(`/admin/finance/invoices/${inv.id}`), r.redirect);
// 2 × 150.25 = 300.50, tax 18% = 54.09; + 2400.00 → 2700.50 + 54.09 = 2754.59
check("draft totals computed by the database, decimal-exact", inv && inv.status === "draft" && inv.invoice_number === null
  && Number(inv.subtotal) === 2700.5 && Number(inv.tax_total) === 54.09 && Number(inv.total) === 2754.59,
  JSON.stringify(inv));
const PAGE = `/admin/finance/invoices/${inv.id}`;
let page = await html(PAGE, finance);
check("draft page shows the editor and Issue", page.includes("Draft invoice") && page.includes("Issue invoice") && page.includes("Port handling"));
r = await formAction(finance, "saveInvoiceDraft", [inv.id, undefined],
  { shipment_id: shipId, currency: "USD", lines: lines([...LINES, { description: "Storage, 3 days (TEST)", quantity: "3", unit_price: "35.00", tax_rate: "18" }]) }, PAGE);
[inv] = await invoicesOf();
// + 105.00, tax 18.90 → 2805.50 + 72.99 = 2878.49
check("editing the draft replaces its lines", r.value?.ok === true && Number(inv.total) === 2878.49, JSON.stringify([r.value, inv.total]));
check("ops manager sees the draft but no editor", !(await html(PAGE, ops)).includes("Issue invoice"));

// ---- issue ----
r = await formAction(admin, "issueInvoice", [inv.id, undefined], { issue_date: "", due_date: "" }, PAGE);
[inv] = await invoicesOf();
const terms = akagera.billing_terms_days ?? 30;
const plus = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
check("issuing assigns INV-YYYY-NNNNN and the client's terms", r.value?.ok === true && /^INV-\d{4}-\d{5,}$/.test(inv.invoice_number ?? "")
  && inv.status === "issued" && inv.due_date === plus(inv.issue_date, terms), JSON.stringify([r.value, inv]));
const INV = inv.invoice_number;
r = await formAction(finance, "saveInvoiceDraft", [inv.id, undefined], { shipment_id: shipId, currency: "USD", lines: lines(LINES) }, PAGE);
check("an issued invoice cannot be edited", r.value?.ok !== true && /draft/i.test(r.value?.error ?? ""), JSON.stringify(r.value));
r = await formAction(finance, "issueInvoice", [inv.id, undefined], {}, PAGE);
check("cannot be issued twice", r.value?.ok !== true && /already issued/i.test(r.value?.error ?? ""), JSON.stringify(r.value));
check("list shows the invoice", (await html("/admin/finance", finance)).includes(INV));
check("shipment page shows the invoice in Finance", (await html(`/admin/shipments/${shipId}`, finance)).includes(INV));

// ---- payments ----
const now = new Date(Date.now() - 3600e3).toISOString();
const pay = (who, fields, cur = "USD") => formAction(who, "recordPayment", [inv.id, cur, undefined], { paid_at: now, ...fields }, PAGE).then((x) => x.value);
r = await pay(finance, { amount: "1000", method: "bank_transfer" });
check("a bank transfer needs a reference", r?.fieldErrors?.reference?.length > 0, JSON.stringify(r));
r = await pay(finance, { amount: "100.00", method: "cash" }, "EUR");
check("a payment in another currency is refused", r?.ok !== true && /USD/.test(r?.error ?? ""), JSON.stringify(r));
r = await pay(finance, { amount: "3000.00", method: "cash" });
check("a payment above the balance is refused", r?.ok !== true && /more than what is left/i.test(r?.error ?? ""), JSON.stringify(r));
r = await pay(doc, { amount: "10.00", method: "cash" });
check("doc officer cannot record payments", r?.ok !== true);
r = await pay(finance, { amount: "1000.00", method: "bank_transfer", reference: `BK-${stamp}` });
check("finance records a payment", r?.ok === true, JSON.stringify(r));
r = await pay(finance, { amount: "5.00", method: "mobile_money", reference: `bk-${stamp}` });
check("the same reference twice is refused (case-insensitive)", r?.ok !== true && /already recorded/i.test(r?.error ?? ""), JSON.stringify(r));
[inv] = await invoicesOf();
check("an unverified payment does not reduce the balance", Number(inv.balance_due) === 2878.49 && inv.status === "issued");
const { data: p1 } = await svc.from("payments").select("id").eq("invoice_id", inv.id).single();
r = await formAction(admin, "reviewPayment", [p1.id, undefined], { decision: "verified" }, PAGE);
check("admin cannot verify payments (finance only)", !(await svc.from("payment_reviews").select("payment_id").eq("payment_id", p1.id)).data?.length);
r = await formAction(finance, "reviewPayment", [p1.id, undefined], { decision: "verified" }, PAGE);
check("finance verifies → receipt number", r.value?.ok === true && /RCPT-\d{4}-\d{5,}/.test(r.value?.message ?? ""), JSON.stringify(r.value));
[inv] = await invoicesOf();
const { data: shipFin } = await svc.from("shipments").select("finance_status").eq("id", shipId).single();
check("verified payment: partly paid, balance 1878.49, shipment partly paid", inv.status === "partially_paid"
  && Number(inv.amount_paid) === 1000 && Number(inv.balance_due) === 1878.49 && shipFin.finance_status === "partially_paid", JSON.stringify([inv, shipFin]));
r = await formAction(finance, "reviewPayment", [p1.id, undefined], { decision: "rejected", reason: "second try" }, PAGE);
check("a payment is reviewed only once", r.value?.ok !== true && /already been reviewed/i.test(r.value?.error ?? ""), JSON.stringify(r.value));

const receipt = `/admin/finance/receipts/${p1.id}`;
page = await html(receipt, finance);
check("printable receipt: number, amount, invoice", /RCPT-\d{4}-\d{5,}/.test(page) && page.includes("1,000.00 USD") && page.includes(INV) && page.includes("Print or save as PDF"));
check("ops manager can open the receipt", (await html(receipt, ops)).includes("1,000.00 USD"));
check("doc officer cannot open the receipt", !(await html(receipt, doc)).includes("1,000.00 USD"));

r = await pay(finance, { amount: "50.00", method: "cash", note: "Counter payment (TEST)" });
const { data: p2 } = await svc.from("payments").select("id").eq("invoice_id", inv.id).eq("method", "cash").single();
r = await formAction(finance, "reviewPayment", [p2.id, undefined], { decision: "rejected", reason: "" }, PAGE);
check("rejecting needs a reason", r.value?.fieldErrors?.reason?.length > 0, JSON.stringify(r.value));
r = await formAction(finance, "reviewPayment", [p2.id, undefined], { decision: "rejected", reason: "Not found in the cash book (TEST)" }, PAGE);
[inv] = await invoicesOf();
check("a rejected payment changes nothing", r.value?.ok === true && Number(inv.balance_due) === 1878.49, JSON.stringify(r.value));
check("receipt of a rejected payment is 'not found'", !(await html(`/admin/finance/receipts/${p2.id}`, finance)).includes("50.00 USD"));

// ---- credit note, void, dispute ----
r = await formAction(finance, "issueCreditNote", [inv.id, "USD", undefined], { amount: "78.49", reason: "Storage waived as goodwill (TEST)" }, PAGE);
[inv] = await invoicesOf();
check("credit note → CN number, balance 1800.00", r.value?.ok === true && /CN-\d{4}-\d{5,}/.test(r.value?.message ?? "")
  && Number(inv.amount_credited) === 78.49 && Number(inv.balance_due) === 1800, JSON.stringify([r.value, inv.balance_due]));
r = await formAction(finance, "voidInvoice", [inv.id, undefined], { reason: "Wrong client (TEST)" }, PAGE);
check("an invoice with payments cannot be voided", r.value?.ok !== true && /credit note instead/i.test(r.value?.error ?? ""), JSON.stringify(r.value));
r = await formAction(ops, "setInvoiceDispute", [inv.id, true, undefined], { reason: "Client queries the storage days (TEST)" }, PAGE);
[inv] = await invoicesOf();
check("ops manager opens a dispute → disputed", r.value?.ok === true && inv.status === "disputed", JSON.stringify(r.value));
check("invoice page shows the dispute", (await html(PAGE, finance)).includes("Client queries the storage days"));
r = await formAction(doc, "setInvoiceDispute", [inv.id, false, undefined], { reason: "trying" }, PAGE);
check("doc officer cannot resolve it", (await invoicesOf())[0].status === "disputed");
r = await formAction(finance, "setInvoiceDispute", [inv.id, false, undefined], { reason: "Storage days confirmed with the client (TEST)" }, PAGE);
[inv] = await invoicesOf();
check("finance resolves → partly paid again", r.value?.ok === true && inv.status === "partially_paid", JSON.stringify(r.value));

r = await pay(finance, { amount: "1800.00", method: "mobile_money", reference: `MM-${stamp}` });
const { data: p3 } = await svc.from("payments").select("id").eq("invoice_id", inv.id).eq("method", "mobile_money").single();
await formAction(finance, "reviewPayment", [p3.id, undefined], { decision: "verified" }, PAGE);
[inv] = await invoicesOf();
const { data: shipPaid } = await svc.from("shipments").select("finance_status").eq("id", shipId).single();
check("final payment verified → paid, balance 0, shipment paid", inv.status === "paid" && Number(inv.balance_due) === 0 && shipPaid.finance_status === "paid",
  JSON.stringify([inv.status, inv.balance_due, shipPaid]));
r = await pay(finance, { amount: "1.00", method: "cash" });
check("no payments on a paid invoice", r?.ok !== true && /unpaid invoice/i.test(r?.error ?? ""), JSON.stringify(r));

// ---- void a second draft ----
await formAction(finance, "saveInvoiceDraft", [null, undefined], { shipment_id: shipId, currency: "USD", lines: lines(LINES.slice(0, 1)) }, NEW);
const draft2 = (await invoicesOf())[1];
r = await formAction(finance, "voidInvoice", [draft2.id, undefined], { reason: "Duplicate draft (TEST)" }, `/admin/finance/invoices/${draft2.id}`);
const [, voided] = await invoicesOf();
check("a draft can be voided (no number used)", r.value?.ok === true && voided.status === "void" && voided.invoice_number === null, JSON.stringify(r.value));
check("audit log records the invoice changes", ((await svc.from("audit_log").select("id").eq("table_name", "invoices").eq("record_id", inv.id)).data ?? []).length >= 3);

// ---- client portal (0022) ----
console.log("\nFinance in the client portal:");
const jean = await login("jean@kivuhardware.example");
const { data: rv1 } = await svc.from("payment_reviews").select("receipt_number").eq("payment_id", p1.id).single();
const RC = rv1.receipt_number;
const list = await html("/portal/invoices", aline);
check("client sees the invoice in /portal/invoices", list.includes(INV) && list.includes("Paid and cancelled"));
const invPage = await html(`/portal/invoices/${INV}`, aline);
check("invoice page: charges, payments with receipt links, no internal notes or rejected payment",
  invPage.includes("Port handling") && invPage.includes(`/portal/receipts/${RC}`) && invPage.includes("ref BK-")
  && !invPage.includes("Counter payment") && !invPage.includes("Not found in the cash book") && !invPage.includes("goodwill"));
check("the voided draft is not shown to the client", !list.includes("Duplicate draft"));
check("receipt page for the client", (await html(`/portal/receipts/${RC}`, aline)).includes("1,000.00 USD"));
check("another client gets 'not found' for the invoice", !(await html(`/portal/invoices/${INV}`, jean)).includes("Port handling"));
check("…and for the receipt", !(await html(`/portal/receipts/${RC}`, jean)).includes("1,000.00 USD"));
check("…and does not list it", !(await html("/portal/invoices", jean)).includes(INV));
check("staff opening /portal/invoices → /admin", (await loc("/portal/invoices", finance)).endsWith("/admin"));
check("shipment page links the invoice", (await html(`/portal/shipments/${ship.shipment_reference}`, aline)).includes(`/portal/invoices/${INV}`));

const { data: alineP } = await svc.from("profiles").select("id").eq("email", "aline@akagera.example").single();
const notes = async (template) => (await svc.from("notifications").select("payload, recipient_id")
  .eq("template_key", template).eq("shipment_id", shipId)).data ?? [];
const issuedN = await notes("invoice.issued");
check("invoice issued → Akagera's users notified (only them), number and total as text",
  issuedN.some((n) => n.recipient_id === alineP.id) && issuedN.every((n) => n.payload.invoice_number === INV && n.payload.total === "2878.49"),
  JSON.stringify(issuedN.map((n) => n.payload.total)));
const verN = (await notes("payment.verified")).filter((n) => n.recipient_id === alineP.id);
check("2 verified payments → 2 messages, balances after each (1878.49, then 0.00)",
  verN.length === 2 && verN.map((n) => n.payload.balance_due).sort().join() === "0.00,1878.49", JSON.stringify(verN.map((n) => n.payload)));
check("the rejected payment sent nothing", !verN.some((n) => n.payload.amount === "50.00"));
const inbox = await html("/portal/notifications", aline);
check("inbox shows 'Invoice …' and 'payment received'", inbox.includes(`Invoice ${INV}`) && inbox.includes(`${INV}: payment received`));
check("Kivu's users got none of it", (await svc.from("notifications").select("id, profiles!inner(organization_id)")
  .eq("shipment_id", shipId).neq("profiles.organization_id", akagera.id).in("template_key", ["invoice.issued", "payment.verified"])).data?.length === 0);

// ---- reminders and overdue (0023) ----
console.log("\nPayment reminders:");
const kigaliDay = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali" }).format(new Date(Date.now() + n * 864e5));
await formAction(finance, "saveInvoiceDraft", [null, undefined], { shipment_id: shipId, currency: "USD", lines: lines(LINES.slice(1)) }, NEW);
const late = (await invoicesOf()).find((i) => i.status === "draft");
const LATE = `/admin/finance/invoices/${late.id}`;
r = await formAction(finance, "issueInvoice", [late.id, undefined], { issue_date: kigaliDay(-12), due_date: kigaliDay(-8) }, LATE);
const lateRow = (await invoicesOf()).find((i) => i.id === late.id);
check("a backdated invoice issued past its due date is overdue at once", r.value?.ok === true && lateRow.status === "overdue", JSON.stringify([r.value, lateRow?.status]));
const { data: finP } = await svc.from("profiles").select("id").eq("email", "finance@ngb.example").single();
const alertsFor = async (tpl, id) => ((await svc.from("notifications").select("id").eq("template_key", tpl)
  .eq("recipient_id", finP.id).like("event_key", `invoice:${id}:%`)).data ?? []).length;
check("finance is alerted that it is overdue", (await alertsFor("staff.invoice_overdue", late.id)) === 1);
check("finance was alerted when the first invoice was disputed", (await alertsFor("staff.invoice_disputed", inv.id)) === 1);

r = await formAction(doc, "runFinanceReminders", [], {}, "/admin/finance");
check("doc officer cannot run reminders", !(r.redirect ?? "").includes("reminders="), r.redirect);
r = await formAction(finance, "runFinanceReminders", [], {}, "/admin/finance");
check("finance runs reminders now → result shown", /reminders=\d+-\d+/.test(r.redirect ?? ""), r.redirect);
const rem = (await svc.from("invoice_reminders").select("stage, days_from_due").eq("invoice_id", late.id)).data ?? [];
check("8 days overdue → the +7 stage only, logged once", rem.length === 1 && rem[0].stage === 7 && rem[0].days_from_due === 8, JSON.stringify(rem));
const remN = (await svc.from("notifications").select("recipient_id, payload").eq("event_key", `reminder:${late.id}:7`)).data ?? [];
check("client users notified with days overdue and balance as text",
  remN.some((n) => n.recipient_id === alineP.id) && remN.every((n) => n.payload.days_from_due === 8 && n.payload.balance_due === "2400.00"), JSON.stringify(remN.map((n) => n.payload)));
await formAction(finance, "runFinanceReminders", [], {}, "/admin/finance");
check("running again sends no second reminder (AC-13)",
  ((await svc.from("invoice_reminders").select("id").eq("invoice_id", late.id)).data ?? []).length === 1
  && ((await svc.from("notifications").select("id").like("event_key", `reminder:${late.id}:%`).eq("recipient_id", alineP.id)).data ?? []).length === 1);
check("the paid invoice got no reminder", ((await svc.from("invoice_reminders").select("id").eq("invoice_id", inv.id)).data ?? []).length === 0);
check("invoice page lists the reminder", (await html(LATE, finance)).includes("8 days overdue"));
check("client inbox shows 'payment overdue'", (await html("/portal/notifications", aline)).includes(`${lateRow.invoice_number}: payment overdue`));

finish();
