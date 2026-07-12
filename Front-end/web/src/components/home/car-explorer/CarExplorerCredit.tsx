/**
 * REQUIRED CC-BY-4.0 attribution for the 3D model (see
 * public/models/toyota-hilux/CREDITS.txt). Must stay visible to end users.
 * Shared by every place the car explorer is rendered.
 */
export default function CarExplorerCredit({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[10px] leading-relaxed text-ink-muted/70 ${className}`}>
      3D model:{' '}
      <a
        href="https://sketchfab.com/3d-models/2022-toyota-hilux-82bd37c5065040098fb0b86e07fcb959"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-ink-muted"
      >
        &ldquo;2022 Toyota Hilux&rdquo;
      </a>{' '}
      by{' '}
      <a href="https://sketchfab.com/BHP3D" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink-muted">
        BHP3D
      </a>{' '}
      &middot;{' '}
      <a
        href="http://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-ink-muted"
      >
        CC-BY-4.0
      </a>
    </p>
  );
}
