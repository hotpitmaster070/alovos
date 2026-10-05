"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Menu, X } from "lucide-react";
import { BLOCKS, blockHref } from "@/lib/blocks";

function Brand() {
  return (
    <Link
      href="/"
      className="text-[22px] font-medium leading-none tracking-tight text-[#D9C5A5]"
      aria-label="alovOS"
    >
      al
      <svg
        aria-hidden="true"
        style={{
          display: "inline-block",
          height: "0.85em",
          width: "0.6em",
          margin: "0 1px",
          verticalAlign: "baseline",
        }}
        viewBox="0 0 24 34"
        fill="none"
        stroke="#D9C5A5"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 C 8 12, 4 16, 4 23 C 4 28, 7.6 32, 12 32 C 16.4 32, 20 28, 20 23 C 20 16, 16 12, 12 2Z" />
      </svg>
      vOS
    </Link>
  );
}

function NavItem({
  href,
  active,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 text-[11px] font-medium uppercase tracking-widest transition-colors ${
        active
          ? "border-[#D9C5A5] bg-[#151515] text-white"
          : "border-transparent text-[#888] hover:border-[#222] hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <div className="flex items-center justify-between border-b border-[#222] bg-[#0A0A0A] px-4 py-3 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Menyunu bağla" : "Menyunu aç"}
          aria-expanded={open}
          aria-controls="app-nav"
          className="rounded-[12px] border border-[#222] p-2 text-[#D9C5A5]"
        >
          {open ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
        </button>
      </div>

      <aside
        id="app-nav"
        className={`${
          open ? "block" : "hidden"
        } border-b border-[#222] bg-[#0A0A0A] p-4 lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-64 lg:overflow-y-auto lg:border-b-0 lg:border-r`}
      >
        <div className="mb-6 hidden px-3 lg:block">
          <Brand />
        </div>
        <nav aria-label="Modullar" className="flex flex-col gap-1">
          <NavItem
            href="/app/dashboard"
            active={pathname === "/app/dashboard"}
            onClick={close}
          >
            <LayoutDashboard size={18} strokeWidth={1.5} color="#D9C5A5" aria-hidden="true" />
            Dashboard
          </NavItem>
          {BLOCKS.map((block) => {
            const Icon = block.icon;
            const href = blockHref(block);
            return (
              <NavItem key={block.slug} href={href} active={pathname === href} onClick={close}>
                <Icon size={18} strokeWidth={1.5} color="#D9C5A5" aria-hidden="true" />
                <span className="flex-1 whitespace-nowrap">{block.label}</span>
                {block.killer && (
                  <span className="rounded-full border border-[#D9C5A5] px-1.5 py-0.5 text-[8px] text-[#D9C5A5]">
                    KILLER
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
