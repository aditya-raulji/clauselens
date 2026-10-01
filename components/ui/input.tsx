import React from "react";
import clsx from "clsx";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, disabled, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        disabled={disabled}
        className={clsx(
          "w-full px-3.5 py-2.5 text-sm bg-[#FCFBF8] text-[#171717] placeholder:text-[#77736C]/70",
          "border rounded-[12px] transition-all duration-150 outline-none",
          "hover:border-[#d9d3c7] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15",
          "disabled:opacity-50 disabled:bg-[#F7F5F0] disabled:cursor-not-allowed",
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500/15" : "border-[#E7E2D9]",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
