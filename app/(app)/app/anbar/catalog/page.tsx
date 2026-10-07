import { redirect } from "next/navigation";
import { isUuid, type RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_CATALOG_PATH } from "@/lib/auth-redirect";

/** English alias for the catalog; the canonical route is /app/anbar/kataloq. */
export default function CatalogAliasPage({ searchParams }: { searchParams: RawSearchParams }) {
  const branch = typeof searchParams.branch === "string" && isUuid(searchParams.branch) ? searchParams.branch : null;
  redirect(branch ? `${ANBAR_CATALOG_PATH}?branch=${branch}` : ANBAR_CATALOG_PATH);
}
