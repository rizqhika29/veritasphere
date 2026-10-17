"use client";
import { Warp } from "@paper-design/shaders-react";

// Global fixed background for ALL pages — Warp shader + readability veils.
// Content must sit above (z-10). Text improved with drop-shadows in pages.
export default function SphereBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-0 overflow-hidden bg-sphere-950">
      <div className="absolute inset-0">
        <Warp
          style={{ height: "100%", width: "100%" }}
          proportion={0.45}
          softness={1}
          distortion={0.25}
          swirl={0.8}
          swirlIterations={10}
          shape="checks"
          shapeScale={0.1}
          scale={1}
          rotation={0}
          speed={0.6}
          colors={["hsl(250,100%,16%)", "hsl(260,100%,62%)", "hsl(190,100%,50%)", "hsl(265,90%,32%)"]}
        />
      </div>
      {/* readability veils */}
      <div className="absolute inset-0 bg-gradient-to-b from-sphere-950/80 via-sphere-950/55 to-sphere-950/85" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(6,7,26,0.55)_75%)]" />
    </div>
  );
}
