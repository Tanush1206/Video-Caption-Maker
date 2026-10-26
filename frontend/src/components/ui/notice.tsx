import { AlertCircle, AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const TONE = {
  info: { icon: Info, colour: "text-muted-foreground" },
  warning: { icon: AlertTriangle, colour: "text-warning" },
  error: { icon: AlertCircle, colour: "text-destructive" },
} as const;

/**
 * Something the app has to say about a video (v1.1.0): on the grouped tone,
 * no border, no tinted fill. The colour is on the small icon only (and it is
 * the AA text tone, so it reads on either theme); the words carry the
 * meaning. `title` is the one line that matters, `children` the detail and
 * any controls under it.
 */
export function Notice({
  tone = "info",
  title,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: keyof typeof TONE;
  title?: React.ReactNode;
}) {
  const { icon: Icon, colour } = TONE[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl bg-card px-4 py-3", className)} {...props}>
      <Icon className={cn("mt-[3px] size-4 shrink-0", colour)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground">
        {title && <p className="text-[15px] font-medium leading-[22px] text-foreground">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}
