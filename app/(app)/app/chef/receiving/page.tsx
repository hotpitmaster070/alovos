import ReceivingPage from "@/components/receiving/receiving-page";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { CHEF_RECEIVING_PATH } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default function ChefReceivingPage({ searchParams }: { searchParams: RawSearchParams }) {
  return <ReceivingPage path={CHEF_RECEIVING_PATH} searchParams={searchParams} />;
}
