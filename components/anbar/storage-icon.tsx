import { Boxes, Refrigerator, Snowflake, Warehouse, type LucideProps } from "lucide-react";
import type { StorageType } from "@/lib/anbar/types";

const ICONS = { soyuducu: Refrigerator, dondurucu: Snowflake, quru: Warehouse, custom: Boxes } as const;

export default function StorageIcon({ type, ...props }: { type: StorageType } & LucideProps) {
  const Icon = ICONS[type];
  return <Icon aria-hidden="true" {...props} />;
}
