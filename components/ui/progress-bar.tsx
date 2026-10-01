import React from "react";
import clsx from "clsx";

export interface ProgressBarProps {
  value: number; // 0 to 100
  max?: number;
  label?: string;
  showPercentage?: boolean;
  className?: string;
  color?: "orange" | "green" | "blue";
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercentage = false,
  className,
  color = "orange",
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, Math.round((value / max) * 100)));

  const colorStyles = {
    orange: "bg-[#F97316]",
    green: "bg-[#3F7D58]",
    blue: "bg-[#5267A8]",
  };

  return (
    <div className={clsx("w-full", className)}>
      {(label || showPercentage) && (
        <div className="flex justify-between items-center text-xs text-[#77736C] mb-1.5 font-medium">
          {label && <span>{label}</span>}
          {showPercentage && <span>{percentage}%</span>}
        </div>
      )}
      <div className="w-full h-1.5 bg-[#E7E2D9] rounded-full overflow-hidden">
        <div
          className={clsx(
            "h-full transition-all duration-300 rounded-full",
            colorStyles[color]
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
