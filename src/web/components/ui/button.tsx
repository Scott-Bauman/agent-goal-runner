import type { ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800 focus-visible:ring-zinc-950",
  secondary:
    "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-100 focus-visible:ring-zinc-400",
  ghost:
    "border-transparent bg-transparent text-zinc-700 hover:bg-zinc-100 focus-visible:ring-zinc-400",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function Button({
  className = "",
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type={type}
      {...props}
    />
  );
}
