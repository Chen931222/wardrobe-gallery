// [本 fork 修改] 上游 tandpfun/wardrobe 既有檔案。本 fork 的改動:跳過 IPX 的路徑由 /api/ 改為 /data/(衣櫃圖片搬到 /data/library/,線上靜態版沒有 IPX 伺服器)。
import { forwardRef } from "react";
import { Image } from "@unpic/react";

const IPX_OPTIONS = { ipx: { baseURL: "/_ipx" } };
const DEFAULT_BREAKPOINTS = [160, 240, 320, 480, 640, 800, 960, 1280];

function sourcePath(src) {
  if (!src || typeof src !== "string") return src;
  return src.split(/[?#]/, 1)[0];
}

export const OptimizedImage = forwardRef(function OptimizedImage({
  src,
  alt = "",
  sizes = "100vw",
  breakpoints = DEFAULT_BREAKPOINTS,
  quality = 80,
  priority = false,
  loading,
  decoding,
  ...props
}, ref) {
  const normalizedSource = sourcePath(src);

  if (!normalizedSource || normalizedSource.startsWith("data:") || normalizedSource.startsWith("blob:") || normalizedSource.startsWith("/data/")) {
    return <img ref={ref} src={src} alt={alt} sizes={sizes} loading={loading || (priority ? "eager" : "lazy")} decoding={decoding || "async"} {...props} />;
  }

  return (
    <Image
      ref={ref}
      src={normalizedSource}
      alt={alt}
      fallback="ipx"
      options={IPX_OPTIONS}
      operations={{ ipx: { quality } }}
      layout="fullWidth"
      unstyled
      sizes={sizes}
      breakpoints={breakpoints}
      priority={priority}
      loading={loading}
      decoding={decoding}
      {...props}
    />
  );
});
