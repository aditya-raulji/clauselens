import React from "react";
import clsx from "clsx";
import { Spinner } from "./spinner";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none rounded-[11px]";

    const sizeStyles = {
      sm: "text-xs px-3 py-1.5 gap-1.5",
      md: "text-sm px-4 py-2 gap-2",
      lg: "text-base px-5 py-2.5 gap-2.5",
    };

    const variantStyles = {
      primary:
        "bg-[#F97316] text-white hover:bg-[#ea580c] active:bg-[#c2410c] border border-[#ea580c]/20 shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
      secondary:
        "bg-[#FCFBF8] text-[#171717] border border-[#E7E2D9] hover:bg-[#F7F5F0] hover:border-[#d9d3c7] active:bg-[#ede8df]",
      ghost:
        "bg-transparent text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/40 active:bg-[#E7E2D9]/70",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={clsx(
          baseStyles,
          sizeStyles[size],
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {isLoading && <Spinner size="sm" className="mr-1" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
