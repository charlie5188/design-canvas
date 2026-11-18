import type { CSSProperties, ImgHTMLAttributes } from "react";

// next/image on the canvas: a plain image with the same layout props.
type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  fill?: boolean;
  priority?: boolean;
  quality?: number | string;
  placeholder?: string;
  blurDataURL?: string;
  loader?: unknown;
  unoptimized?: boolean;
};

const FILL: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };

export default function Image({
  src,
  fill,
  priority,
  quality,
  placeholder,
  blurDataURL,
  loader,
  unoptimized,
  style,
  alt = "",
  ...rest
}: ImageProps) {
  return <img src={typeof src === "string" ? src : src.src} alt={alt} style={fill ? { ...FILL, ...style } : style} {...rest} />;
}
