import type { TenantScope } from "@/lib/anbar/scope";
import { parseDelegations, parseOrders, type Delegation, type ReceivingOrder } from "./model";

/** Supplier orders awaiting delivery to the branch (owner/chef or its delegate; others get an error). */
export async function receivingOrders(scope: TenantScope, branchId: string): Promise<ReceivingOrder[]> {
  const { data, error } = await scope.client.rpc("receiving_orders", { p_branch_id: branchId });
  if (error) throw new Error(`receiving_orders: ${error.message}`);
  return parseOrders(data);
}

/** Running delegations the signed-in user gave (outgoing) or received (incoming). */
export async function myDelegations(scope: TenantScope): Promise<Delegation[]> {
  const { data, error } = await scope.client.rpc("my_delegations");
  if (error) throw new Error(`my_delegations: ${error.message}`);
  return parseDelegations(data);
}

export async function currentUserId(scope: TenantScope): Promise<string | null> {
  const { data } = await scope.client.auth.getUser();
  return data.user?.id ?? null;
}
