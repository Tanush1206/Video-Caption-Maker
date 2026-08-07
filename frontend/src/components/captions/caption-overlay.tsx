"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { captionBoxStyle, captionTextStyle, scaleFor } from "@/lib/caption-style";
import type { Caption } from "@/types/caption";
import type { CaptionStyle, Font } from "@/types/style";

interface CaptionOverlayProps {
  caption: Caption | null;
  style: CaptionStyle | undefined;
  font: Font | undefined;
}

/**
 * The styled caption drawn over the video.
 *
 * This is the thing Milestone 8 has to reproduce, so it measures its own
 * rendered height rather than using the video's pixel dimensions. The player
 * is usually smaller than the file it is playing, and a caption has to take up
 * the same fraction of the frame at either size — otherwise the preview looks
 * right on screen and comes out twice the size in the export.
 */
export function CaptionOverlay({ caption, style, font }: CaptionOverlayProps) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // useLayoutEffect: measure before paint, or the first caption renders at a
  // scale of zero and visibly jumps.
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    setHeight(node.getBoundingClientRect().height);

    return () => observer.disconnect();
  }, []);

  const scale = style ? scaleFor(height, style.reference_height) : 0;

  return (
    <div
      ref={box}
      // pointer-events-none so clicking the caption still plays the video.
      className="pointer-events-none absolute inset-0"
      style={style ? captionBoxStyle(style, scale) : undefined}
    >
      {caption && style && height > 0 && (
        <span style={captionTextStyle(style, font, scale, caption)}>
          {caption.text}
        </span>
      )}
    </div>
  );
}
