import React from "react";
import clsx from "clsx";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "verified" | "unverified" | "ai" | "processing";
  size?: "sm" | "md";
}

export function Badge({
  variant = "neutral",
  size = "md",
  className,
  children,
  ...props
}: BadgeProps) {
  const baseStyles =
    "inline-flex items-center gap-1.5 font-medium rounded-full border transition-colors select-none";

  const sizeStyles = {
    sm: "px-2 py-0.5 text-[11px] leading-tight",
    md: "px-2.5 py-1 text-xs leading-none",
  };

  const variantStyles = {
    neutral: "bg-[#F7F5F0] text-[#77736C] border-[#E7E2D9]",
    verified: "bg-[#3F7D58]/10 text-[#3F7D58] border-[#3F7D58]/30",
    unverified: "bg-[#B7791F]/10 text-[#B7791F] border-[#B7791F]/30",
    ai: "bg-[#5267A8]/10 text-[#5267A8] border-[#5267A8]/30",
    processing: "bg-[#F97316]/10 text-[#F97316] border-[#F97316]/30 animate-pulse",
  };

  return (
    <span
      className={clsx(
        baseStyles,
        sizeStyles[size],
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {variant === "verified" && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#3F7D58]" />
      )}
      {variant === "unverified" && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#B7791F]" />
      )}
      {variant === "ai" && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#5267A8]" />
      )}
      {variant === "processing" && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#F97316]" />
      )}
      {children}
    </span>
  );
}
