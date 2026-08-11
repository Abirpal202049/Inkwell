/** Inkwell brand mark: a fountain-pen nib with breather hole and slit.
 *  Stroke-based so it sits naturally alongside the lucide icon set;
 *  size and color come from the className, same as a lucide icon. */
export function InkwellLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M7 3h10c0 7-1.6 11.2-5 18-3.4-6.8-5-11-5-18Z" />
      <path d="M12 20v-6.5" />
      <circle cx="12" cy="10.25" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
