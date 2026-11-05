// Live: sign-in (real server action), role-based routing, isolation on the portal (Task 4 / AC-05)
import { APP, PW, check, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("— auth & routing —");
const anonAdmin = await get("/admin");
check("signed-out /admin → /login", anonAdmin.status === 307 && /\/login/.test(anonAdmin.headers.get("location") ?? ""), anonAdmin.headers.get("location"));
const anonPortal = await get("/portal");
check("signed-out /portal → /login", anonPortal.status === 307 && /\/login/.test(anonPortal.headers.get("location") ?? ""));

const signIn = (email, password, next = "") => formAction(null, "signIn", [undefined], { email, password, next }, "/login");
const bad = await signIn("admin@ngb.example", "wrong-password-123");
check("wrong password → generic message", bad.value?.error === "Incorrect email or password.", bad.value?.error);
const unknown = await signIn("nobody@ngb.example", "wrong-password-123");
check("unknown account → the same message (no account enumeration)", unknown.value?.error === "Incorrect email or password.");
const okAdmin = await signIn("admin@ngb.example", PW);
check("admin signs in → /admin, session cookie set", /\/admin/.test(okAdmin.redirect ?? "") && (okAdmin.headers.get("set-cookie") ?? "").includes("auth-token"), okAdmin.redirect);
const okClient = await signIn("aline@akagera.example", PW);
check("client signs in → /portal", /\/portal/.test(okClient.redirect ?? ""), okClient.redirect);
const sneaky = await signIn("aline@akagera.example", PW, "/admin/users");
check("client's next=/admin is ignored → /portal", /\/portal/.test(sneaky.redirect ?? "") && !/admin/.test(sneaky.redirect ?? ""), sneaky.redirect);
const offsite = await signIn("admin@ngb.example", PW, "//evil.example/admin");
check("off-site next is ignored", !/evil/.test(offsite.redirect ?? ""), offsite.redirect);

const admin = await login("admin@ngb.example");
const aline = await login("aline@akagera.example");
const r1 = await get("/admin", aline);
check("client opening /admin → /portal", r1.status === 307 && r1.headers.get("location")?.endsWith("/portal"));
const r2 = await get("/portal", admin);
check("staff opening /portal → /admin", r2.status === 307 && r2.headers.get("location")?.endsWith("/admin"));
const r3 = await get("/login", aline);
check("signed-in user opening /login → home", r3.status === 307 && r3.headers.get("location")?.endsWith("/portal"));
const r4 = await get("/portal", aline);
check("protected pages are private, no-store", (r4.headers.get("cache-control") ?? "").includes("no-store"));

// /portal is the Overview (active shipments only); the full list is /portal/shipments?view=all (newest first, 200 max).
const html = (await pageText(r4)) + (await pageText(await get("/portal/shipments?view=all", aline)));
const { data: orgs } = await svc.from("organizations").select("id, client_code").in("client_code", ["AKAGERA", "KIVU"]);
const id = (c) => orgs.find((o) => o.client_code === c).id;
const { data: own } = await svc.from("shipments").select("shipment_reference").eq("client_id", id("AKAGERA")).order("created_at", { ascending: false }).limit(3);
const { data: theirs } = await svc.from("shipments").select("shipment_reference").eq("client_id", id("KIVU"));
check("portal lists the client's own shipments", own.every((s) => html.includes(s.shipment_reference)));
check("portal shows none of another client's shipments (AC-05)", theirs.every((s) => !html.includes(s.shipment_reference)), `${theirs.length} Kivu refs checked`);
check(`app reachable at ${APP}`, true);
finish();
