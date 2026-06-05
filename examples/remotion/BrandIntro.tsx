// Example animated brand intro: title fades + rises in, optional subtitle below.
// Illustrative only (not type-checked by the package). Props are passed via
// renderRemotion({ props }) / the "remotion" EDL clip's `props`.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const BrandIntro: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B1220", justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity, transform: `translateY(${y}px)`, textAlign: "center" }}>
        <h1 style={{ color: "white", fontSize: 96, fontFamily: "Segoe UI, sans-serif", margin: 0 }}>
          {title}
        </h1>
        {subtitle ? (
          <p style={{ color: "#9FB3C8", fontSize: 44, fontFamily: "Segoe UI, sans-serif", marginTop: 24 }}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
