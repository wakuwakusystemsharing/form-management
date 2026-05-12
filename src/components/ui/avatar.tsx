import * as React from "react"
import Image from "next/image"

import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = "Avatar"

const AvatarImage = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof Image>
>(({ className, alt = '', src, ...props }, ref) => {
  if (!src) return null;
  return (
    <div ref={ref} className="absolute inset-0 z-10">
      <Image
        src={src}
        alt={alt}
        fill
        sizes="80px"
        className={cn("object-cover", className)}
        {...props}
      />
    </div>
  );
})
AvatarImage.displayName = "AvatarImage"

const AvatarFallback = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "absolute inset-0 flex items-center justify-center bg-muted",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = "AvatarFallback"

export { Avatar, AvatarImage, AvatarFallback }

