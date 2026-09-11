import type { ImgHTMLAttributes } from "react";
type Props = ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean; unoptimized?: boolean };
export function getImageProps({ priority: _priority, fill, unoptimized: _unoptimized, ...props }: Props) {
  return { props: { ...props, ...(fill ? { style: { position: "absolute" as const, height: "100%", width: "100%", inset: 0, ...props.style } } : {}) } };
}
export default function Image(input: Props) { const { props } = getImageProps(input); return <img {...props} alt={props.alt ?? ""} />; }
