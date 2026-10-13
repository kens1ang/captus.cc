import { cx } from "./ui";

// Placeholders shown by the loading.tsx files while a page's server data loads,
// so a click in the nav responds instantly instead of freezing on the old page.

export function Bone({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-subtle", className)} />;
}

export function PageSkeleton({ wide, header = true }: { wide?: boolean; header?: boolean }) {
  return (
    <div
      className={cx("mx-auto flex w-full flex-col gap-8 px-6 py-8 lg:px-10", wide ? "max-w-6xl" : "max-w-4xl")}
      aria-busy="true"
      aria-label="Loading"
    >
      {header && (
        <div className="flex flex-col gap-2 border-b border-line pb-6">
          <Bone className="h-7 w-48" />
          <Bone className="h-4 w-80 max-w-full" />
        </div>
      )}
      <CardSkeleton rows={3} />
      <CardSkeleton rows={2} />
    </div>
  );
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-line bg-panel shadow-xs">
      <div className="border-b border-line px-5 py-4">
        <Bone className="h-4 w-40" />
      </div>
      <div className="flex flex-col gap-4 p-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Bone className="h-3.5 w-28" />
            <Bone className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
