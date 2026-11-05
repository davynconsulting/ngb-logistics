import { describe, expect, it } from "vitest";
import { clientSchema } from "@/lib/validation/client";
import { inviteUserSchema } from "@/lib/validation/user";
import { containersFromForm, registerShipmentSchema } from "@/lib/validation/shipment";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("client form", () => {
  const base = {
    client_code: " akagera ", legal_name: "Akagera Trading Ltd", primary_contact_name: "Aline",
    phone_e164: "+250 788 123 456", preferred_language: "en", timezone: "Africa/Kigali",
    billing_terms_days: "30", credit_limit: "25,000.00", credit_currency: "USD",
  };
  it("normalizes code, phone and amounts", () => {
    const r = clientSchema.parse(base);
    expect(r.client_code).toBe("AKAGERA");
    expect(r.phone_e164).toBe("+250788123456");
    expect(r.credit_limit).toBe("25000.00");
    expect(r.billing_terms_days).toBe(30);
    expect(r.show_driver_contact).toBe(false);
  });
  it("needs a currency when a credit limit is set", () => {
    const r = clientSchema.safeParse({ ...base, credit_currency: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["credit_currency"]);
  });
  it.each(["A", "TOO-LONG-CLIENT-CODE-X", "ak agera", "-ABC"])("rejects code %j", (client_code) => {
    expect(clientSchema.safeParse({ ...base, client_code }).success).toBe(false);
  });
  it("rejects a local phone number", () => {
    expect(clientSchema.safeParse({ ...base, phone_e164: "0788123456" }).success).toBe(false);
  });
});

describe("invite form", () => {
  it("requires a company for client users only", () => {
    expect(inviteUserSchema.safeParse({ email: "a@b.example", full_name: "A", role: "client" }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ email: "a@b.example", full_name: "A", role: "client", organization_id: uuid }).success).toBe(true);
    expect(inviteUserSchema.safeParse({ email: "A@B.example ", full_name: "A", role: "finance" }).data?.email).toBe("a@b.example");
  });
  it("rejects unknown roles", () => {
    expect(inviteUserSchema.safeParse({ email: "a@b.example", full_name: "A", role: "superuser" }).success).toBe(false);
  });
});

describe("shipment registration", () => {
  const base = {
    client_id: uuid, origin_port_id: uuid, destination_country: "RW", destination_city: "Kigali",
    required_documents: ["bill_of_lading"], containers: [{ container_number: "msku 123456-5", size_type: "40HC", seal_number: "" }],
  };
  it("normalizes container numbers and accepts a valid form", () => {
    const r = registerShipmentSchema.parse(base);
    expect(r.containers[0].container_number).toBe("MSKU1234565");
  });
  it("flags a bad check digit on the right row", () => {
    const r = registerShipmentSchema.safeParse({ ...base, containers: [base.containers[0], { container_number: "MSKU1234566" }] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["containers", 1, "container_number"]);
    expect(r.error?.issues[0].message).toMatch(/Check digit/);
  });
  it("flags duplicates within the form", () => {
    const r = registerShipmentSchema.safeParse({ ...base, containers: [base.containers[0], { container_number: "MSKU1234565" }] });
    expect(r.error?.issues.map((i) => i.message)).toContain("Listed twice");
  });
  it("needs at least one container", () => {
    expect(registerShipmentSchema.safeParse({ ...base, containers: [] }).success).toBe(false);
  });
  it("reads repeated container fields and skips empty rows", () => {
    const fd = new FormData();
    for (const [n, s, seal] of [["MSKU1234565", "40HC", "S1"], ["", "20GP", ""], ["TGHU1234567", "", ""]]) {
      fd.append("container_number", n); fd.append("size_type", s); fd.append("seal_number", seal);
    }
    expect(containersFromForm(fd)).toEqual([
      { container_number: "MSKU1234565", size_type: "40HC", seal_number: "S1" },
      { container_number: "TGHU1234567", size_type: "", seal_number: "" },
    ]);
  });
});

describe("email normalization", () => {
  it("accepts surrounding spaces and upper case (sign-in and invites)", async () => {
    const { emailField } = await import("@/lib/validation/common");
    expect(emailField.parse("  Aline@Akagera.EXAMPLE ")).toBe("aline@akagera.example");
    expect(emailField.safeParse("not-an-email").success).toBe(false);
  });
});
