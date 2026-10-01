import React from "react";
import clsx from "clsx";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center text-center p-8 sm:p-12",
        "bg-[#FCFBF8] border border-dashed border-[#E7E2D9] rounded-[16px]",
        className
      )}
    >
      {icon && (
        <div className="w-12 h-12 rounded-[12px] bg-[#F7F5F0] border border-[#E7E2D9] flex items-center justify-center text-[#77736C] mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[#171717]">{title}</h3>
      <p className="text-sm text-[#77736C] max-w-sm mt-1 mb-5 leading-relaxed">
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}
