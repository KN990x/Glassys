import { useMemo } from "react";
import { encode } from "uqr";

/** One path of unit squares for the dark modules, run-length merged along each row. */
export function qrPath(value: string): { size: number; d: string } {
  const qr = encode(value, { ecc: "L" });
  const size = qr.size;
  const raw = qr.data as boolean[][] | boolean[];
  const dark = (x: number, y: number) =>
    Array.isArray(raw[0]) ? Boolean((raw as boolean[][])[y]?.[x]) : Boolean((raw as boolean[])[y * size + x]);
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark(x, y)) continue;
      let run = 1;
      while (x + run < size && dark(x + run, y)) run++;
      parts.push(`M${x} ${y}h${run}v1h-${run}z`);
      x += run - 1;
    }
  }
  return { size, d: parts.join("") };
}

/**
 * A QR code is data drawn as a picture, not an icon, so it is generated here rather than taken
 * from Icon.tsx. One path instead of a <rect> per module (several hundred elements), computed
 * once per value.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, d } = useMemo(() => qrPath(value), [value]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="white" />
      <path d={d} fill="black" />
    </svg>
  );
}
