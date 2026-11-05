import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET } from "@/lib/domain/documents";

/**
 * View or download a document: /documents/{id} (inline) or /documents/{id}?download=1
 *
 * The documents row is read AS THE USER, so RLS decides access (clients: own
 * organization and client-visible only; agents/drivers: assigned shipments).
 * The signed URL is also created as the user (storage RLS checks again) and
 * expires after 60 seconds. Unknown or forbidden ids get the same 404 (AC-16).
 */
const SIGNED_URL_SECONDS = 60;
const PRIVATE = { "Cache-Control": "private, no-store" };
const notFound = () => new NextResponse("Document not found", { status: 404, headers: PRIVATE });

export async function GET(request: NextRequest, ctx: RouteContext<"/documents/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();

  const user = await getCurrentUser();
  if (!user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `/documents/${id}`);
    return NextResponse.redirect(login, { status: 303, headers: PRIVATE });
  }

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!doc) return notFound();

  const download = request.nextUrl.searchParams.has("download");
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, download ? { download: doc.file_name } : undefined);
  if (error || !data?.signedUrl) return notFound();

  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { ...PRIVATE, "Referrer-Policy": "no-referrer" } });
}
