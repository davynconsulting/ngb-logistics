/**
 * NGB LOGISTICS: development seed data (Sprint 1, Task 3)
 *
 * Creates FICTIONAL test data in the hosted DEV project (or the STAGING project, see below) only:
 *   • the NGB organization + 4 fictional client companies (names end in "(TEST)")
 *   • one staff user per role + 2 users per client (all @….example emails,
 *     a reserved domain, so no real person is ever emailed)
 *   • 20 draft shipments with containers, document checklists, sample PDFs
 *     and clearing-agent / driver assignments
 *
 * Safe to re-run: every record is looked up by a natural key first and only
 * created if missing. It never deletes or overwrites business data.
 *
 * Run:  npm run db:seed
 * Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *                      SEED_USER_PASSWORD (shared password for all test users)
 *
 * Phone numbers use +250 000 000 0NN, which cannot reach a real subscriber.
 * WhatsApp opt-in stays OFF for every test user.
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------
const DEV_PROJECT_REF = "idyydcuihxkyitylkugo";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = process.env.SEED_USER_PASSWORD ?? "";

// The staging project (fictional data for acceptance and training) is allowed only when named
// explicitly in its own env file (.env.staging.local: STAGING_PROJECT_REF). Never a production project.
const STAGING_PROJECT_REF = process.env.STAGING_PROJECT_REF ?? "";
const allowed = [DEV_PROJECT_REF, STAGING_PROJECT_REF].filter((r) => /^[a-z]{20}$/.test(r));
const target = allowed.find((r) => new URL(url || "http://x").hostname === `${r}.supabase.co`);
if (!target) {
  console.error(`Refusing to seed: this script only runs against the dev project (${DEV_PROJECT_REF}) or the staging project named in STAGING_PROJECT_REF.`);
  process.exit(1);
}
console.log(`Seeding ${target === DEV_PROJECT_REF ? "DEV" : "STAGING"} project ${target}`);
if (!serviceKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is missing from .env.local");
  process.exit(1);
}
if (password.length < 12) {
  console.error("SEED_USER_PASSWORD (12+ characters) is missing from .env.local");
  process.exit(1);
}

const db = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type AppRole = Database["public"]["Enums"]["app_role"];
type DocType = Database["public"]["Enums"]["document_type"];

const stats = { created: 0, existing: 0 };
const log = (kind: "created" | "existing", what: string) => {
  stats[kind]++;
  console.log(`  ${kind === "created" ? "+" : "="} ${what}`);
};

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Like must(), but also fails if no row came back. */
function need<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = must(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no data returned`);
  return data;
}

/** Deterministic UUID from a name, so re-runs find the same document ids. */
function stableUuid(name: string): string {
  const h = createHash("sha1").update(`ngb-seed:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** ISO 6346 check digit (same rule as lib/domain/container-number.ts). */
function containerNumber(owner3: string, serial: number): string {
  const first10 = `${owner3}U${String(serial).padStart(6, "0")}`;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i];
    let v: number;
    if (i < 4) {
      const base = ch.charCodeAt(0) - 55;
      v = base + Math.floor((base - 1) / 10);
    } else v = Number(ch);
    sum += v * 2 ** i;
  }
  return `${first10}${(sum % 11) % 10}`;
}

/** Minimal valid one-page PDF clearly labelled as test data. */
function samplePdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = [
    "BT /F1 18 Tf 50 780 Td",
    `(${esc(title)}) Tj`,
    "/F1 11 Tf 0 -28 Td",
    ...lines.map((l) => `(${esc(l)}) Tj 0 -16 Td`),
    "/F1 14 Tf 0 -24 Td (TEST DOCUMENT - FICTIONAL DATA - NOT VALID FOR SHIPPING) Tj",
    "ET",
  ].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

// ---------------------------------------------------------------------------
// Fictional reference data
// ---------------------------------------------------------------------------
const NGB = { client_code: "NGB", legal_name: "NGB LOGISTICS" };

const CLIENTS = [
  {
    client_code: "AKAGERA", legal_name: "Akagera Trading Ltd (TEST)",
    primary_contact_name: "Aline Uwase", phone_e164: "+2500000000101", email: "accounts@akagera.example",
    billing_address: "KG 7 Ave, Kigali, Rwanda (fictional)", tax_id: "TEST-TIN-101",
    preferred_language: "en", timezone: "Africa/Kigali", billing_terms_days: 30,
    credit_limit: "25000.00", credit_currency: "USD", city: "Kigali", country: "RW", owner: "AKG",
    users: [["aline@akagera.example", "Aline Uwase"], ["eric@akagera.example", "Eric Mugisha"]],
  },
  {
    client_code: "KIVU", legal_name: "Kivu Hardware Supplies Ltd (TEST)",
    primary_contact_name: "Jean Habimana", phone_e164: "+2500000000102", email: "office@kivuhardware.example",
    billing_address: "Avenue de la Paix, Rubavu, Rwanda (fictional)", tax_id: "TEST-TIN-102",
    preferred_language: "fr", timezone: "Africa/Kigali", billing_terms_days: 15,
    credit_limit: null, credit_currency: null, city: "Rubavu", country: "RW", owner: "KVH",
    users: [["jean@kivuhardware.example", "Jean Habimana"], ["claudine@kivuhardware.example", "Claudine Ingabire"]],
  },
  {
    client_code: "NYUNGWE", legal_name: "Nyungwe Agro Inputs Ltd (TEST)",
    primary_contact_name: "Patrick Niyonzima", phone_e164: "+2500000000103", email: "orders@nyungweagro.example",
    billing_address: "Huye Road, Huye, Rwanda (fictional)", tax_id: "TEST-TIN-103",
    preferred_language: "rw", timezone: "Africa/Kigali", billing_terms_days: 30,
    credit_limit: "15000000.00", credit_currency: "RWF", city: "Huye", country: "RW", owner: "NYA",
    users: [["patrick@nyungweagro.example", "Patrick Niyonzima"], ["diane@nyungweagro.example", "Diane Uwimana"]],
  },
  {
    client_code: "RUZIZI", legal_name: "Ruzizi Pharma Distributors (TEST)",
    primary_contact_name: "Esperance Ndayishimiye", phone_e164: "+2570000000104", email: "supply@ruzizipharma.example",
    billing_address: "Boulevard du Peuple, Bujumbura, Burundi (fictional)", tax_id: "TEST-NIF-104",
    preferred_language: "fr", timezone: "Africa/Bujumbura", billing_terms_days: 45,
    credit_limit: "40000.00", credit_currency: "USD", city: "Bujumbura", country: "BI", owner: "RZP",
    users: [["esperance@ruzizipharma.example", "Esperance Ndayishimiye"], ["olivier@ruzizipharma.example", "Olivier Nkurunziza"]],
  },
] as const;

const STAFF: [email: string, name: string, role: AppRole][] = [
  ["admin@ngb.example", "Grace Mukamana", "admin"],
  ["ops.manager@ngb.example", "David Nkusi", "ops_manager"],
  ["doc.officer@ngb.example", "Solange Uwera", "doc_officer"],
  ["clearing.agent@ngb.example", "Emmanuel Kamanzi", "clearing_agent"],
  ["transport@ngb.example", "Yves Tuyishime", "transport_coord"],
  ["driver@ngb.example", "Joseph Hakizimana", "driver"],
  ["finance@ngb.example", "Josiane Mutoni", "finance"],
];

const CARGO = [
  ["Galvanised roofing sheets", 420, 24800],
  ["Agricultural fertiliser (NPK 17-17-17), 50 kg bags", 1100, 27500],
  ["Pharmaceutical consumables (non-controlled)", 260, 6200],
  ["Steel reinforcement bars", 90, 26000],
  ["Solar panels and inverters", 180, 9800],
  ["Cooking oil, 20 L jerrycans", 1300, 26600],
  ["Ceramic floor tiles", 640, 25400],
  ["Maize seed, certified, 25 kg bags", 980, 24500],
  ["Medical gloves and syringes", 350, 5400],
  ["PVC water pipes", 220, 11800],
] as const;

const LINES = [
  ["MSC", "MV Lake Kivu Star", "KV214W"],
  ["Maersk", "MV Indian Ocean Dawn", "IO338N"],
  ["CMA CGM", "MV Savanna Trader", "ST097E"],
  ["Hapag-Lloyd", "MV Rift Valley Express", "RV561S"],
  ["ONE", "MV Zanzibar Breeze", "ZB120W"],
] as const;

// ---------------------------------------------------------------------------
async function upsertOrg(row: Record<string, unknown>, internal: boolean) {
  const code = row.client_code as string;
  const found = must(await db.from("organizations").select("id").eq("client_code", code).maybeSingle(), `find org ${code}`);
  if (found) { log("existing", `organization ${code}`); return found.id; }
  const created = need(
    await db.from("organizations").insert({ ...row, is_internal: internal } as Database["public"]["Tables"]["organizations"]["Insert"]).select("id").single(),
    `create org ${code}`,
  );
  log("created", `organization ${code}`);
  return created.id;
}

let userIndex: Map<string, string> | undefined;
async function findUserId(email: string) {
  if (!userIndex) {
    userIndex = new Map();
    for (let page = 1; ; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      data.users.forEach((u) => u.email && userIndex!.set(u.email, u.id));
      if (data.users.length < 1000) break;
    }
  }
  return userIndex.get(email);
}

async function upsertUser(email: string, fullName: string, role: AppRole, orgId: string, phone?: string) {
  const existing = await findUserId(email);
  if (existing) {
    // Keep the shared test password in sync with .env.local
    const { error } = await db.auth.admin.updateUserById(existing, { password });
    if (error) throw error;
    log("existing", `user ${email} (${role})`);
    return existing;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email is sent
    // Role/org go in APP metadata (server-controlled). The DB trigger creates the profile.
    app_metadata: { role, organization_id: orgId, full_name: fullName, phone_e164: phone ?? null, seed: true },
  });
  if (error) throw new Error(`create user ${email}: ${error.message}`);
  userIndex!.set(email, data.user.id);
  log("created", `user ${email} (${role})`);
  return data.user.id;
}

async function main() {
  console.log(`Seeding fictional test data into ${DEV_PROJECT_REF}\n`);

  console.log("Organizations");
  const ngbId = await upsertOrg(NGB, true);

  console.log("\nStaff users");
  const staff: Record<string, string> = {};
  for (const [i, [email, name, role]] of STAFF.entries()) {
    staff[role] = await upsertUser(email, name, role, ngbId, `+25000000002${String(i).padStart(2, "0")}`);
  }

  console.log("\nClient organizations and users");
  const clientIds: Record<string, string> = {};
  for (const c of CLIENTS) {
    const { city, country, owner, users, ...org } = c;
    void city; void country; void owner;
    clientIds[c.client_code] = await upsertOrg({ ...org, account_manager_id: staff.ops_manager }, false);
    for (const [j, [email, name]] of users.entries()) {
      await upsertUser(email, name, "client", clientIds[c.client_code], `${c.phone_e164.slice(0, -1)}${j + 5}`);
    }
  }

  const ports = need(await db.from("ports").select("id, code"), "ports");
  const portId = (code: string) => ports.find((p) => p.code === code)!.id;

  console.log("\nShipments, containers, checklists and documents");
  const now = Date.now();
  const day = 86_400_000;
  let n = 0;
  for (const [ci, c] of CLIENTS.entries()) {
    for (let k = 0; k < 5; k++, n++) {
      const bl = `TESTBL${String(260001 + n)}`;
      const [cargo, packages, weight] = CARGO[n % CARGO.length];
      const [line, vessel, voyage] = LINES[n % LINES.length];
      const origin = n % 3 === 2 ? "KEMBA" : "TZDAR";

      const found = must(
        await db.from("shipments").select("id, shipment_reference").eq("bl_number", bl).maybeSingle(),
        `find ${bl}`,
      );
      let shipment: { id: string; shipment_reference: string };
      if (found) {
        shipment = found;
        log("existing", `shipment ${shipment.shipment_reference} (${bl})`);
      } else {
        shipment = need(
          await db.from("shipments").insert({
            client_id: clientIds[c.client_code],
            booking_reference: `TESTBK-${c.client_code}-${k + 1}`,
            bl_number: bl,
            shipping_line: line,
            vessel_name: vessel,
            voyage_number: voyage,
            origin_port_id: portId(origin),
            origin_terminal: origin === "TZDAR" ? "Dar es Salaam Container Terminal" : "Mombasa Container Terminal",
            destination_country: c.country,
            destination_city: c.city,
            delivery_address: `${c.legal_name.replace(" (TEST)", "")} warehouse, ${c.city} (fictional)`,
            cargo_description: cargo,
            package_count: packages,
            gross_weight_kg: weight,
            // Spread planned arrivals from 10 days ago to ~3 weeks ahead
            planned_vessel_arrival: new Date(now + (n - 6) * 1.5 * day).toISOString(),
            assigned_ops_user_id: k % 2 === 0 ? staff.ops_manager : staff.doc_officer,
          }).select("id, shipment_reference").single(),
          `create ${bl}`,
        );
        log("created", `shipment ${shipment.shipment_reference} (${bl}, ${c.client_code})`);
      }

      // 1–3 containers per shipment
      const containerCount = (n % 3) + 1;
      for (let x = 0; x < containerCount; x++) {
        const number = containerNumber(c.owner, 100000 + n * 10 + x);
        const exists = must(
          await db.from("containers").select("id").eq("shipment_id", shipment.id).eq("container_number", number).maybeSingle(),
          `find container ${number}`,
        );
        if (exists) { log("existing", `  container ${number}`); continue; }
        must(
          await db.from("containers").insert({
            shipment_id: shipment.id,
            container_number: number,
            size_type: x % 2 === 0 ? "40HC" : "20GP",
            seal_number: `TESTSEAL${String(n * 10 + x).padStart(5, "0")}`,
          }),
          `create container ${number}`,
        );
        log("created", `  container ${number}`);
      }

      // Document checklist; BL "received" on most shipments, missing on every 4th
      const blReceived = n % 4 !== 3;
      const checklist: [DocType, boolean, string | null][] = [
        ["bill_of_lading", blReceived, blReceived ? null : "Please send the original bill of lading."],
        ["commercial_invoice", n % 2 === 0, n % 2 === 0 ? null : "Commercial invoice not yet received."],
        ["packing_list", true, null],
      ];
      for (const [type, received, note] of checklist) {
        const r = await db.from("document_requirements").insert({
          shipment_id: shipment.id,
          document_type: type,
          status: received ? "received" : "missing",
          client_note: note,
        });
        if (r.error && !r.error.message.includes("duplicate")) throw new Error(r.error.message);
        if (!r.error) log("created", `  checklist ${type} (${received ? "received" : "missing"})`);
      }

      // Sample BL PDF in private storage (client-visible)
      if (blReceived) {
        await addDocument(shipment.id, clientIds[c.client_code], bl, "bill_of_lading", true, staff.doc_officer,
          `Bill of Lading ${bl}`, [`Shipper: Overseas Supplier Co (fictional)`, `Consignee: ${c.legal_name}`, `Vessel: ${vessel} / ${voyage}`, `Cargo: ${cargo}`]);
      }
      // One internal-only customs working paper per client (hidden from clients)
      if (k === 0) {
        await addDocument(shipment.id, clientIds[c.client_code], `${bl}-customs`, "customs_entry", false, staff.clearing_agent,
          `Customs working notes ${bl}`, ["INTERNAL - not visible to the client", "Draft tariff classification and duty estimate"]);
      }

      // Assign the clearing agent to the first two shipments of each client,
      // and the driver to the first shipment of the first two clients.
      if (k < 2) await assign(shipment.id, staff.clearing_agent, "clearing agent");
      if (k === 0 && ci < 2) await assign(shipment.id, staff.driver, "driver");
    }
  }

  console.log(`\nDone: ${stats.created} created, ${stats.existing} already existed.`);
}

async function addDocument(
  shipmentId: string, clientId: string, key: string, type: DocType, clientVisible: boolean,
  uploadedBy: string, title: string, lines: string[],
) {
  const id = stableUuid(`doc:${key}`);
  const exists = must(await db.from("documents").select("id").eq("id", id).maybeSingle(), `find doc ${key}`);
  if (exists) { log("existing", `  document ${type}`); return; }
  const fileName = `${type}-${key}.pdf`.toLowerCase();
  const path = `${clientId}/${shipmentId}/${id}/${fileName}`;
  const pdf = samplePdf(title, lines);
  const up = await db.storage.from("shipment-documents").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(`upload ${path}: ${up.error.message}`);
  must(
    await db.from("documents").insert({
      id, shipment_id: shipmentId, document_type: type, storage_path: path, file_name: fileName,
      mime_type: "application/pdf", size_bytes: pdf.byteLength, uploaded_by: uploadedBy, client_visible: clientVisible,
    }),
    `create doc ${key}`,
  );
  log("created", `  document ${type}${clientVisible ? "" : " (internal only)"}`);
}

async function assign(shipmentId: string, userId: string, label: string) {
  const r = await db.from("shipment_assignments").insert({ shipment_id: shipmentId, user_id: userId });
  if (r.error && !r.error.message.includes("duplicate")) throw new Error(r.error.message);
  if (!r.error) log("created", `  assigned ${label}`);
}

main().catch((e) => {
  console.error("\nSeed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
