//! A canvas painter for the `Scene` the harness emits.
//!
//! The display list is the same one the native Direct2D painter consumes, so the web surface uses
//! the component's geometry, not a parallel UI. Rust's default serde enum representation is
//! externally tagged: struct variants arrive as `{ "FillRect": { … } }` and the unit `PopClip`
//! arrives as the bare string `"PopClip"`.

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Scene {
  size: { width: number; height: number };
  draws: Array<string | Record<string, unknown>>;
  logs?: string[];
  /**
   * A spinner the module asks the host to draw and animate itself. The module has no clock, so it
   * can only turn one while the host keeps asking for frames; a host with a clock of its own keeps
   * it turning even while the module is blocked inside a call.
   */
  spinner?: Spinner;
}

export interface Spinner {
  x: number;
  y: number;
  radius: number;
}

type Payload = Record<string, any>;

export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.size.width, scene.size.height);

  for (const draw of scene.draws) {
    if (typeof draw === "string") {
      if (draw === "PopClip") {
        ctx.restore();
      }
      continue;
    }
    const kind = Object.keys(draw)[0];
    if (!kind) {
      continue;
    }
    const payload = draw[kind] as Payload;
    switch (kind) {
      case "Clear":
        ctx.fillStyle = css(payload.color);
        ctx.fillRect(0, 0, scene.size.width, scene.size.height);
        break;
      case "FillRect":
        ctx.fillStyle = css(payload.color);
        ctx.fillRect(payload.x, payload.y, payload.width, payload.height);
        break;
      case "StrokeRect": {
        const t = payload.thickness as number;
        ctx.lineWidth = t;
        ctx.strokeStyle = css(payload.color);
        ctx.strokeRect(
          payload.x + t / 2,
          payload.y + t / 2,
          Math.max(0, payload.width - t),
          Math.max(0, payload.height - t),
        );
        break;
      }
      case "FillRoundedRect":
        roundedPath(ctx, payload.x, payload.y, payload.width, payload.height, payload.radius);
        ctx.fillStyle = css(payload.color);
        ctx.fill();
        break;
      case "StrokeRoundedRect": {
        const t = payload.thickness as number;
        roundedPath(
          ctx,
          payload.x + t / 2,
          payload.y + t / 2,
          Math.max(0, payload.width - t),
          Math.max(0, payload.height - t),
          Math.max(0, payload.radius - t / 2),
        );
        ctx.lineWidth = t;
        ctx.strokeStyle = css(payload.color);
        ctx.stroke();
        break;
      }
      case "FillCircle":
        ctx.beginPath();
        ctx.arc(payload.x, payload.y, payload.radius, 0, Math.PI * 2);
        ctx.fillStyle = css(payload.color);
        ctx.fill();
        break;
      case "StrokeLine":
        ctx.beginPath();
        ctx.moveTo(payload.x0, payload.y0);
        ctx.lineTo(payload.x1, payload.y1);
        ctx.lineWidth = payload.thickness;
        ctx.lineCap = "round";
        ctx.strokeStyle = css(payload.color);
        ctx.stroke();
        break;
      case "FillPolygon":
      case "StrokePolygon": {
        const points = payload.points as Point[];
        if (!points || points.length < 2) {
          break;
        }
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        if (kind === "FillPolygon") {
          ctx.fillStyle = css(payload.color);
          ctx.fill();
        } else {
          ctx.lineWidth = payload.thickness;
          ctx.lineJoin = "round";
          ctx.strokeStyle = css(payload.color);
          ctx.stroke();
        }
        break;
      }
      case "FillText":
        ctx.save();
        ctx.fillStyle = css(payload.color);
        ctx.font = `${payload.size}px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(payload.text, payload.x, payload.y);
        ctx.restore();
        break;
      case "PushClipRect":
        ctx.save();
        ctx.beginPath();
        ctx.rect(payload.x, payload.y, payload.width, payload.height);
        ctx.clip();
        break;
      default:
        // A primitive this painter does not know is skipped rather than aborting the frame.
        break;
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function css(color: Color): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${color.a})`;
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
