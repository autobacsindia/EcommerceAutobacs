import Link from 'next/link';

export type Crumb = { label: string; href?: string };

/**
 * The page header every customer page shares with the home page's look: white band,
 * breadcrumb trail, bold Montserrat title, a one-line explanation and an optional
 * slot on the right (result count, actions). Styles: `.sp-head*` in store.css.
 */
export default function StorePageHeader({
  title,
  subtitle,
  crumbs = [],
  aside,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  crumbs?: Crumb[];
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="sp-head">
      <div className="sp-head-in">
        {crumbs.length > 0 && (
          <nav className="sp-crumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="sp-crumb">
                <span aria-hidden="true">›</span>
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="sp-head-row">
          <div className="sp-head-text">
            <h1 className="sp-title">{title}</h1>
            {subtitle && <p className="sp-sub">{subtitle}</p>}
          </div>
          {aside && <div className="sp-head-aside">{aside}</div>}
        </div>
        {children}
      </div>
    </header>
  );
}
