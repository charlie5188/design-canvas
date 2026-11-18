import { type ComponentType, createElement, lazy, Suspense } from "react";

// next/dynamic on the canvas: React's own lazy loading, with the `loading` component while it loads.
type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };
export default function dynamic<P extends object>(load: () => Promise<Loaded<P>>, options?: { loading?: ComponentType }) {
  const Lazy = lazy(async () => {
    const loaded = await load();
    return { default: "default" in loaded ? loaded.default : loaded };
  });
  const Loading = options?.loading;
  return function Dynamic(props: P) {
    return createElement(Suspense, { fallback: Loading ? createElement(Loading) : null }, createElement(Lazy as ComponentType<P>, props));
  };
}
