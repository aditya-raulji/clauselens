"use client";

import React, { useEffect } from "react";
import clsx from "clsx";
import { X } from "lucide-react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, children, className }: DialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    if (open) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#171717]/30 backdrop-blur-[2px] transition-opacity"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Dialog Card */}
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          "relative z-10 w-full max-w-lg bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px]",
          "shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 overflow-hidden",
          className
        )}
      >
        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 p-1 rounded-lg text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/50 transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("mb-4", className)} {...props}>
      {children}
    </div>
  );
}

export function DialogTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={clsx(
        "text-lg font-semibold text-[#171717] tracking-tight",
        className
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={clsx("text-sm text-[#77736C] mt-1.5", className)} {...props}>
      {children}
    </p>
  );
}

export function DialogFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "mt-6 flex items-center justify-end gap-3 pt-3 border-t border-[#E7E2D9]/60",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
