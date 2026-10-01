"use client";

import React, { useEffect } from "react";
import { AlertCircle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log non-sensitive error message
    console.error("Global app error caught:", error.message);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
      <div className="w-14 h-14 rounded-[14px] bg-[#FCFBF8] border border-red-200 flex items-center justify-center text-red-600 mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <AlertCircle className="w-7 h-7" />
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-red-600 mb-1">
        Application Error
      </span>
      <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">
        Something went wrong
      </h1>
      <p className="text-sm text-[#77736C] max-w-sm mt-2 mb-6">
        An error occurred while loading this view. You can retry or head back to your workspace.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="md" onClick={() => reset()}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
        <a href="/">
          <Button variant="primary" size="md">
            <Home className="w-4 h-4 mr-2" />
            Home
          </Button>
        </a>
      </div>
    </div>
  );
}
