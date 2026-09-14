import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
