"use client";

import PreviewGeneric from "./PreviewGeneric";
import type { ProcessedImage } from "@/lib/pipeline";

/**
 * Image → 3D preview. Delegates to the shared multi-part viewer (so it gets the
 * same world-colour and orbit-target controls as every other 3D tool); its
 * parts are the processed model's per-colour meshes.
 */
export default function Preview3D({
  processed,
  fitNonce,
}: {
  processed: ProcessedImage;
  fitNonce: number;
}) {
  return (
    <PreviewGeneric
      parts={processed.meshes}
      bboxMm={processed.bboxMm}
      centerMm={processed.centerMm}
      fitNonce={fitNonce}
    />
  );
}
