import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const Command = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn("flex h-full w-full flex-col overflow-hidden rounded-md bg-card", className)}
    {...props}
  />
));
Command.displayName = "Command";

const CommandInput = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-3">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = "CommandInput";

const CommandList = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-72 overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));
CommandList.displayName = "CommandList";

const CommandEmpty = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />
));
CommandEmpty.displayName = "CommandEmpty";

const CommandGroup = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = "CommandGroup";

const CommandItem = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
