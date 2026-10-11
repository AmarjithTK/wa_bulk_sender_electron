import { cn } from '../../lib/utils';
export function Card({ className, ...props }) {
  return <section data-slot="card" className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...props} />;
}
export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1.5 p-5 pb-4', className)} {...props} />;
}
export function CardTitle({ className, ...props }) {
  return <h2 className={cn('text-sm font-semibold tracking-tight', className)} {...props} />;
}
export function CardDescription({ className, ...props }) {
  return <p className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />;
}
export function CardContent({ className, ...props }) {
  return <div className={cn('space-y-4 px-5 pb-5', className)} {...props} />;
}
