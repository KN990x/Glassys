import { encode } from "uqr";

export function QrCode({ value, label }: { value: string; label: string }) {
  const qr = encode(value, { ecc: "L" });
  const size = qr.size;
  const raw = qr.data as boolean[][] | boolean[];
  const rows: boolean[][] = Array.isArray(raw[0])
    ? (raw as boolean[][])
    : Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => Boolean((raw as boolean[])[y * size + x])),
      );
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="white" />
      {rows.map((row, y) =>
        row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="black" /> : null)),
      )}
    </svg>
  );
}
