import React from "react";
import clsx from "clsx";
import { AlertCircle } from "lucide-react";
import { Button } from "./button";

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message = "An unexpected error occurred while processing your request.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center text-center p-8 bg-[#FCFBF8] border border-red-200 rounded-[16px] max-w-md mx-auto my-6",
        className
      )}
    >
      <div className="w-12 h-12 rounded-[12px] bg-red-50 border border-red-100 flex items-center justify-center text-red-600 mb-4">
        <AlertCircle className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-[#171717]">{title}</h3>
      <p className="text-sm text-[#77736C] mt-1 mb-5 leading-relaxed">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
