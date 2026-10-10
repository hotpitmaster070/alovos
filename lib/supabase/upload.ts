import { createClient } from "@/lib/supabase/client";

export const PROOFS_BUCKET = "inventory-proofs";
const SIGNED_URL_TTL = 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROOF_TYPE = /^[a-z0-9-]{1,32}$/;

export type ProofPathInput = {
  tenantId: string;
  branchId: string;
  /** A product id, or a word such as "invoice" for documents not tied to one product. */
  productId: string;
  type: string;
  date?: Date;
};

/** {tenant_id}/{branch_id}/{year}/{month}/{product_id}_{type}_{timestamp}.jpg; the first two folders are what storage RLS checks. */
export function proofPath({ tenantId, branchId, productId, type, date = new Date() }: ProofPathInput): string {
  if (!UUID.test(tenantId) || !UUID.test(branchId)) throw new Error("invalid proof path id");
  if (!UUID.test(productId) && !PROOF_TYPE.test(productId)) throw new Error("invalid proof product");
  if (!PROOF_TYPE.test(type)) throw new Error("invalid proof type");
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${tenantId}/${branchId}/${year}/${month}/${productId}_${type}_${date.getTime()}.jpg`;
}

/** Uploads to the private bucket. Store `path`; `url` is a short-lived signed link for immediate display. */
export async function uploadProof(file: File, path: string): Promise<{ path: string; url: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(PROOFS_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (error) throw error;
  const { data } = await supabase.storage.from(PROOFS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return { path, url: data?.signedUrl ?? null };
}
