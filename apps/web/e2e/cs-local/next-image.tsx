import type { ImgHTMLAttributes } from "react";
export default function Image({ priority: _priority, alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) {
  return <img alt={alt ?? ""} {...props} />;
}
