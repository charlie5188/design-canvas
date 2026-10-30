import { type AnchorHTMLAttributes, forwardRef } from "react";

// next/link on the canvas: a plain anchor. The canvas keeps the click on the
// canvas and shows where it would have gone.
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string | null };
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, ...rest },
  ref,
) {
  const url = typeof href === "string" ? href : (href.pathname ?? "/");
  return <a ref={ref} href={url} {...rest} />;
});

export default Link;
