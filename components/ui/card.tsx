import React from "react";
import clsx from "clsx";

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-150",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("p-5 border-b border-[#E7E2D9]/70", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={clsx(
        "text-base font-semibold text-[#171717] tracking-tight",
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={clsx("text-xs text-[#77736C] mt-1 leading-relaxed", className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function CardContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("p-5", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "p-5 pt-0 flex items-center justify-between border-t border-[#E7E2D9]/40 mt-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
