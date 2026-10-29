// Busselton fork: shop names for their verandah signs, drawn with the browser's fonts. An
// OffscreenCanvas, so it works in the build worker as well as on the page.

/** Shop names for their fascia signs, drawn with the browser's fonts: one w x h row each. */
export function drawSigns(
  names: { text: string; bg: [number, number, number]; ink: [number, number, number]; squeeze: number }[], w: number, h: number,
): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(w, h * names.length);
  const ctx = canvas.getContext("2d")!;
  const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  names.forEach((n, i) => {
    const y = i * h;
    ctx.fillStyle = rgb(n.bg);
    ctx.fillRect(0, y, w, h);
    // A thin border in a mix of the two colours.
    ctx.strokeStyle = rgb([0, 1, 2].map((k) => n.ink[k] * 0.6 + n.bg[k] * 0.4) as [number, number, number]);
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, y + 1.5, w - 3, h - 3);
    ctx.save();
    ctx.translate(w / 2, y + h / 2);
    // Squeezed across, so the letters come out square once stretched along the fascia.
    ctx.scale(n.squeeze, 1);
    ctx.fillStyle = rgb(n.ink);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = Math.round(h * 0.62);
    const font = (px: number) => `bold ${px}px "Helvetica Neue", Arial, "Liberation Sans", sans-serif`;
    ctx.font = font(size);
    // Shrink long names to fit inside the border.
    const room = (w - 24) / n.squeeze;
    const width = ctx.measureText(n.text).width;
    if (width > room) {
      size = Math.max(10, Math.floor((size * room) / width));
      ctx.font = font(size);
    }
    ctx.fillText(n.text, 0, 2);
    ctx.restore();
  });
  return ctx.getImageData(0, 0, w, canvas.height).data;
}

