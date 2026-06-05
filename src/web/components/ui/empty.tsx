import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/web/lib/utils"

const emptyMediaVariants = cva(
  "mb-2 flex items-center justify-center rounded-lg border bg-background shadow-sm",
  {
    variants: {
      variant: {
        default: "size-10",
        icon: "size-10 [&_svg]:size-5 [&_svg]:text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

const Empty = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-6 text-center",
        className,
      )}
      {...props}
    />
  ),
)
Empty.displayName = "Empty"

const EmptyHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col items-center gap-2", className)}
      {...props}
    />
  ),
)
EmptyHeader.displayName = "EmptyHeader"

interface EmptyMediaProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof emptyMediaVariants> {}

const EmptyMedia = React.forwardRef<HTMLDivElement, EmptyMediaProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  ),
)
EmptyMedia.displayName = "EmptyMedia"

const EmptyTitle = React.forwardRef<HTMLHeadingElement, React.ComponentProps<"h3">>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  ),
)
EmptyTitle.displayName = "EmptyTitle"

const EmptyDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<"p">
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("max-w-sm text-sm leading-6 text-muted-foreground", className)}
    {...props}
  />
))
EmptyDescription.displayName = "EmptyDescription"

const EmptyContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col items-center gap-2", className)}
      {...props}
    />
  ),
)
EmptyContent.displayName = "EmptyContent"

export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
}
