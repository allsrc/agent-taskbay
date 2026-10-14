import { Container, PageHeader } from "@/components/patterns/layout";
import { cn } from "@/lib/utils";

/**
 * Scrolling region of a screen. On a phone the document scrolls (so the top bar can collapse its title and the
 * tab bar stays put); from `md` up the screen fills the viewport and this region scrolls on its own.
 */
export const scrollRegion = "md:min-h-0 md:flex-1 md:overflow-auto";

/** A full page: scroll region, width-limited container and the design system's page header. */
export function Page({
  title,
  description,
  eyebrow,
  actions,
  size = "default",
  children,
  className,
  headerChildren,
  detail = false,
}: {
  title: string;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  size?: "narrow" | "default" | "wide";
  children?: React.ReactNode;
  className?: string;
  /** Rendered inside the header, under the description (filters, tabs). */
  headerChildren?: React.ReactNode;
  /** A pane beside a list: stack the actions under the title until there is room for both. */
  detail?: boolean;
}) {
  return (
    <div className={cn("flex flex-1 flex-col", scrollRegion)}>
      <Container size={size} className={cn("py-6 md:py-8", className)}>
        <PageHeader
          title={title}
          description={description}
          eyebrow={eyebrow}
          actions={actions}
          className={detail ? "md:flex-col md:items-stretch 2xl:flex-row 2xl:items-end" : undefined}
        >
          {headerChildren}
        </PageHeader>
        {children}
      </Container>
    </div>
  );
}

/** Centered loading or message state for a page that has not loaded yet. */
export function PageMessage({ children, role = "status" }: { children: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
