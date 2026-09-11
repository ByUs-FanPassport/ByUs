import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";

export async function GET() {
  const wordmark = await readFile(join(process.cwd(), "public/images/guest-home/byus-wordmark-transparent.png"));
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: "#ffffff", color: "#171717" }}>
      {/* The canonical wordmark is an image asset, not typeset UI text. */}
      <img src={`data:image/png;base64,${wordmark.toString("base64")}`} alt="ByUs" width={440} height={181} />
      <div style={{ display: "flex", fontSize: 44, marginTop: 28 }}>Your Bias</div>
      <div style={{ display: "flex", fontSize: 26, marginTop: 64, color: "#737373" }}>byus.kr</div>
    </div>,
    { width: 1200, height: 630 },
  );
}
