"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LayoutDashboard, Menu, X } from "lucide-react";
import Logo from "@/components/logo";
import { BLOCKS, blockHref, getBlockLabel } from "@/lib/blocks";
import { useT } from "@/lib/i18n/useT";

const DASHBOARD_HREF = "/app/dashboard";
const ICON_CLASSES = "h-[18px] w-[18px] text-beige";

type NavItemProps = {
  href: string;
  active: boolean;
  onNavigate: () => void;
  children: ReactNode;
};

function NavItem({ href, active, onNavigate, children }: NavItemProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 text-[11px] font-medium uppercase tracking-widest transition-colors ${
        active
          ? "border-beige bg-card text-white"
          : "border-transparent text-[#888] hover:border-line hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-bg px-4 py-3 lg:hidden">
        <Link href="/" aria-label="alovOS">
          <Logo size="sm" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? t.app.closeMenu : t.app.openMenu}
          aria-expanded={open}
          aria-controls="app-nav"
          className="rounded-[12px] border border-line p-2 text-beige"
        >
          {open ? (
            <X className="h-5 w-5" strokeWidth={1.5} />
          ) : (
            <Menu className="h-5 w-5" strokeWidth={1.5} />
          )}
        </button>
      </div>

      <aside
        id="app-nav"
        className={`${
          open ? "block" : "hidden"
        } border-b border-line bg-bg p-4 lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-64 lg:overflow-y-auto lg:border-b-0 lg:border-r`}
      >
        <Link href="/" className="mb-6 hidden px-3 lg:block" aria-label="alovOS">
          <Logo size="sm" />
        </Link>
        <nav aria-label={t.modulesLabel} className="flex flex-col gap-1">
          <NavItem
            href={DASHBOARD_HREF}
            active={pathname === DASHBOARD_HREF}
            onNavigate={close}
          >
            <LayoutDashboard className={ICON_CLASSES} strokeWidth={1.5} aria-hidden="true" />
            {t.app.dashboard}
          </NavItem>
          {BLOCKS.map((block) => {
            const Icon = block.icon;
            const href = blockHref(block);
            return (
              <NavItem key={block.slug} href={href} active={pathname === href} onNavigate={close}>
                <Icon className={ICON_CLASSES} strokeWidth={1.5} aria-hidden="true" />
                <span className="flex-1 whitespace-nowrap">{getBlockLabel(block, lang)}</span>
                {block.killer && (
                  <span className="rounded-full border border-beige px-1.5 py-0.5 text-[8px] text-beige">
                    {t.app.killer}
                  </span>
                )}
              </NavItem>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
