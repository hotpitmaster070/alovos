"use client";

import Link from "next/link";
import ExpiringAlert from "@/components/chef/expiring-alert";
import { CHEF_DASHBOARD_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import type { CurrencyInfo } from "@/lib/money";

type Branch = { id: string; name: string };

export default function ChefDashboard(
  props:
    | { allowed: false }
    | {
        allowed: true;
        branches: Branch[];
        branchId: string | null;
        expiring: { count: number; value: number | null; href: string };
        currency: CurrencyInfo;
      },
) {
  const { t } = useT();
  const copy = t.expiry.dashboard;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-white/60">{copy.subtitle}</p>
      </div>
      {!props.allowed ? (
        <p role="alert" className="text-sm text-white/70">
          {copy.forbidden}
        </p>
      ) : props.branchId === null ? (
        <p className="text-sm text-white/60">{copy.noBranch}</p>
      ) : (
        <>
          {props.branches.length > 1 && (
            <nav aria-label={copy.branch} className="flex flex-wrap gap-2">
              {props.branches.map((branch) => (
                <Link
                  key={branch.id}
                  href={`${CHEF_DASHBOARD_PATH}?branch=${encodeURIComponent(branch.id)}`}
                  aria-current={branch.id === props.branchId ? "page" : undefined}
                  className={`rounded-[12px] border px-3 py-1.5 text-xs ${
                    branch.id === props.branchId ? "border-beige text-white" : "border-line text-white/60 hover:text-white"
                  }`}
                >
                  {branch.name}
                </Link>
              ))}
            </nav>
          )}
          <ExpiringAlert
            count={props.expiring.count}
            value={props.expiring.value}
            currency={props.currency}
            href={props.expiring.href}
          />
        </>
      )}
    </div>
  );
}
