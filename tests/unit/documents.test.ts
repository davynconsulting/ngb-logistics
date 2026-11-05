import { describe, expect, it } from "vitest";
import {
  cleanFileName, documentStoragePath, formatBytes, resolveMimeType, storageFileName,
  uploadTypesFor, versionChains, canReviewDocuments, MAX_DOCUMENT_BYTES,
} from "@/lib/domain/documents";
import { prepareUploadSchema, reviewSchema } from "@/lib/validation/document";

describe("file names", () => {
  it("strips paths and control characters for display", () => {
    expect(cleanFileName("C:\\Users\\aline\\BL 001.pdf")).toBe("BL 001.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("a\u0000b\nc.pdf")).toBe("abc.pdf");
    expect(cleanFileName("   ")).toBe("document");
    expect(cleanFileName("x".repeat(300) + ".pdf")).toHaveLength(255);
  });

  it("makes storage-safe object names and keeps the extension", () => {
    expect(storageFileName("Facture n°12 (copie).PDF")).toBe("Facture-n-12-copie.pdf");
    expect(storageFileName("Ñandú/../évier.jpg")).toBe("evier.jpg");
    expect(storageFileName("....pdf")).toBe("document.pdf");
    expect(storageFileName("photo")).toBe("photo");
    expect(storageFileName("<script>.html.pdf")).toBe("script-.html.pdf");
  });

  it("builds the {client}/{shipment}/{document}/{file} path", () => {
    expect(documentStoragePath("c", "s", "d", "My BL.pdf")).toBe("c/s/d/My-BL.pdf");
  });
});

describe("resolveMimeType", () => {
  it("accepts allowed types and falls back to the extension for HEIC", () => {
    expect(resolveMimeType("bl.pdf", "application/pdf")).toBe("application/pdf");
    expect(resolveMimeType("IMG_001.HEIC", "")).toBe("image/heic");
    expect(resolveMimeType("IMG_001.heif", "image/heif")).toBe("image/heic");
  });
  it("rejects anything else", () => {
    expect(resolveMimeType("x.html", "text/html")).toBeNull();
    expect(resolveMimeType("x.svg", "image/svg+xml")).toBeNull();
    expect(resolveMimeType("x.exe", "")).toBeNull();
    expect(resolveMimeType("x.pdf", "text/html")).toBeNull();
  });
});

describe("roles", () => {
  it("doc staff upload every type; field roles only evidence; others none", () => {
    expect(uploadTypesFor("doc_officer")).toContain("bill_of_lading");
    expect(uploadTypesFor("clearing_agent")).toContain("customs_entry");
    expect(uploadTypesFor("driver")).not.toContain("bill_of_lading");
    expect(uploadTypesFor("finance")).toEqual([]);
    expect(uploadTypesFor("client")).toEqual([]);
  });
  it("only admin, ops manager and doc officer review", () => {
    expect(canReviewDocuments("doc_officer")).toBe(true);
    expect(canReviewDocuments("clearing_agent")).toBe(false);
    expect(canReviewDocuments("client")).toBe(false);
  });
});

describe("versionChains", () => {
  const d = (id: string, version: number, replaces: string | null) => ({ id, version, replaces_document_id: replaces });
  it("returns the latest version with its history, newest first", () => {
    const chains = versionChains([d("a1", 1, null), d("a3", 3, "a2"), d("b1", 1, null), d("a2", 2, "a1")]);
    expect(chains).toHaveLength(2);
    const a = chains.find((c) => c.latest.id === "a3")!;
    expect(a.history.map((h) => h.id)).toEqual(["a2", "a1"]);
    expect(chains.find((c) => c.latest.id === "b1")!.history).toEqual([]);
  });
});

describe("validation", () => {
  const base = {
    shipmentId: "37019b11-1111-4111-8111-111111111111", documentType: "bill_of_lading", fileName: "bl.pdf",
    mimeType: "application/pdf", size: 1000, clientVisible: true,
  };
  it("accepts a normal upload and turns empty ids into undefined", () => {
    const r = prepareUploadSchema.safeParse({ ...base, containerId: "", replacesId: "" });
    expect(r.success && r.data.containerId === undefined).toBe(true);
  });
  it("rejects too-large, empty, or wrong-type files", () => {
    expect(prepareUploadSchema.safeParse({ ...base, size: MAX_DOCUMENT_BYTES + 1 }).success).toBe(false);
    expect(prepareUploadSchema.safeParse({ ...base, size: 0 }).success).toBe(false);
    expect(prepareUploadSchema.safeParse({ ...base, mimeType: "text/html" }).success).toBe(false);
    expect(prepareUploadSchema.safeParse({ ...base, documentType: "secret" }).success).toBe(false);
  });
  it("rejection needs a reason; verification does not", () => {
    expect(reviewSchema.safeParse({ decision: "verified", reason: "" }).success).toBe(true);
    expect(reviewSchema.safeParse({ decision: "rejected", reason: " " }).success).toBe(false);
    expect(reviewSchema.safeParse({ decision: "rejected", reason: "Amount wrong" }).success).toBe(true);
    expect(reviewSchema.safeParse({ decision: "pending" }).success).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(48213)).toBe("47 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
