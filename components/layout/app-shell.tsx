"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  FileText,
  MessageSquare,
  GitCompare,
  Menu,
  X,
  Upload,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: "Documents", href: "/", icon: FileText },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Compare", href: "/compare", icon: GitCompare },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/documents");
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen flex bg-[#F7F5F0] text-[#171717]">
      {/* Desktop Left Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-[#E7E2D9] bg-[#FCFBF8] shrink-0 sticky top-0 h-screen z-30">
        {/* Brand / Wordmark */}
        <div className="h-16 flex items-center px-6 border-b border-[#E7E2D9]/70">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-[9px] bg-[#F97316] text-white flex items-center justify-center shadow-sm font-semibold text-base transition-transform group-hover:scale-105">
              CL
            </div>
            <span className="font-semibold text-lg tracking-tight text-[#171717]">
              Clause<span className="text-[#F97316]">Lens</span>
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[#77736C]">
            Workspace
          </div>
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 px-3.5 py-2.5 rounded-[11px] text-sm font-medium transition-colors",
                  active
                    ? "bg-[#F97316]/10 text-[#F97316]"
                    : "text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/40"
                )}
              >
                <Icon
                  className={clsx(
                    "w-4 h-4 transition-colors",
                    active ? "text-[#F97316]" : "text-[#77736C]"
                  )}
                />
                <span>{item.label}</span>
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#F97316]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer info */}
        <div className="p-4 border-t border-[#E7E2D9]/70 bg-[#FCFBF8]">
          <div className="flex items-center gap-2 p-2.5 rounded-[12px] bg-[#F7F5F0] border border-[#E7E2D9]">
            <Sparkles className="w-4 h-4 text-[#5267A8] shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-[#171717]">Verified Proofs</p>
              <p className="text-[11px] text-[#77736C]">Zero hallucination engine</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-[#171717]/30 backdrop-blur-xs z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={clsx(
          "fixed inset-y-0 left-0 w-64 bg-[#FCFBF8] border-r border-[#E7E2D9] z-50 md:hidden flex flex-col transition-transform duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-[#E7E2D9]">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5"
          >
            <div className="w-8 h-8 rounded-[9px] bg-[#F97316] text-white flex items-center justify-center font-semibold text-base">
              CL
            </div>
            <span className="font-semibold text-lg tracking-tight text-[#171717]">
              Clause<span className="text-[#F97316]">Lens</span>
            </span>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1 rounded-lg text-[#77736C] hover:text-[#171717]"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={clsx(
                  "flex items-center gap-3 px-3.5 py-2.5 rounded-[11px] text-sm font-medium transition-colors",
                  active
                    ? "bg-[#F97316]/10 text-[#F97316]"
                    : "text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/40"
                )}
              >
                <Icon
                  className={clsx(
                    "w-4 h-4",
                    active ? "text-[#F97316]" : "text-[#77736C]"
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Wrapper */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-[#E7E2D9] bg-[#FCFBF8]/80 backdrop-blur-md px-4 sm:px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 -ml-2 rounded-lg text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/40 md:hidden"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs sm:text-sm text-[#77736C] font-medium hidden sm:block">
              Single-User Contract Intelligence
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/documents/upload">
              <Button size="sm" variant="primary" className="shadow-none">
                <Upload className="w-3.5 h-3.5 mr-1" />
                Upload Contract
              </Button>
            </Link>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
