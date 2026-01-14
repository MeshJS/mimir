import { cn } from "@/lib/cn";

export function InfoCard({ 
  children, 
  className 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-dashed border-edge bg-muted/20 px-4 text-sm text-muted-foreground mb-2",
        className
      )}
    >
      {children}
    </div>
  );
}
