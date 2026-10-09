import ZaqotovkaLink from "@/components/labels/zaqotovka-link";
import { PrepPage } from "@/lib/modules/pages";

export const dynamic = "force-dynamic";

export default async function HazirliqPage(props: Parameters<typeof PrepPage>[0]) {
  return (
    <div className="flex flex-col">
      <ZaqotovkaLink />
      {await PrepPage(props)}
    </div>
  );
}
