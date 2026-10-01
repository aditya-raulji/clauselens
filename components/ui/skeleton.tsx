import React from "react";
import clsx from "clsx";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "animate-pulse rounded-[8px] bg-[#E7E2D9]/60",
        className
      )}
      {...props}
    />
  );
}
