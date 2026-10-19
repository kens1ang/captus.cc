/** The Captus "C" bubble on the brand tile (see brand/captus-icon.svg). */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-md bg-brand text-brand-fg ${className}`}>
      <svg viewBox="0 0 120 120" className="size-[55%]" aria-hidden="true">
        <path fill="currentColor" d="M0 120V28A28 28 0 0 1 28 0H92A28 28 0 0 1 120 28V46H70A14 14 0 0 0 70 74H120V92A28 28 0 0 1 92 120Z" />
      </svg>
    </div>
  );
}
