import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Variant = "default" | "secondary" | "ghost" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  default:
    "bg-gradient-to-r from-orange-500 to-rose-500 text-white font-semibold shadow-md shadow-orange-500/20 hover:shadow-lg hover:shadow-orange-500/25 hover:brightness-110",
  secondary:
    "bg-white/[0.09] text-text-primary border border-white/[0.12] hover:bg-white/[0.14] hover:border-white/[0.18]",
  ghost:
    "bg-transparent text-text-secondary hover:bg-white/[0.08] hover:text-text-primary",
  icon:
    "bg-white/[0.06] text-text-secondary border border-white/[0.1] hover:bg-white/[0.12] hover:text-text-primary",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
