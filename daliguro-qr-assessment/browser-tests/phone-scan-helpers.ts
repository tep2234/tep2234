// Shared helpers for the phone-scanner E2E: sheet rendering, Y4M fake-camera
// file generation, and real pairing-session setup against Supabase.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { buildQrPayload, qrText } from "../src/lib/qr";
import {
  buildTemplate,
  MARKER_RECTS,
  QR_ZONE,
  SHEET_H,
  SHEET_W,
} from "../src/lib/scanner/omr-template";
import type { Learner } from "../src/lib/types";

export const ASSESSMENT_ID = "A1";
export const VERSION = "A";
export const ITEM_COUNT = 10;
export const SHADED = ["B", "C", "A", "D", "B", "C", "A", "D", "B", "C"];
export const LEARNER: Learner = {
  id: "L1",
  lrn: "100000000001",
  fullName: "Dela Cruz, Juan",
  sex: "M",
  gradeLevel: "12",
  section: "Aristotle",
};

// ---------- sheet rendering (same technique as tests/omr-e2e.test.ts) ----------

// Realistic phone camera frame: a LANDSCAPE buffer (matching the scanner's
// requested 2560x1440 stream) with the upright portrait sheet centered on a
// gray desk. This is the exact geometry that regressed when frames were
// downscaled by width instead of by their smaller side.
export const CAMERA_W = 2560;
export const CAMERA_H = 1440;
const SHEET_MARGIN = 40; // desk visible around the page, like a real capture
const S = (CAMERA_H - SHEET_MARGIN) / SHEET_H; // sheet nearly fills frame height

interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Real paper under room light photographs well below saturation (~230); a
// pure-255 fill trips the scanner's glare gate, which is correct behavior.
const PAPER_WHITE = 232;
const INK_BLACK = 22;

function whiteSheet(w: number, h: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = PAPER_WHITE;
  }
  return { data, width: w, height: h };
}
function rect(img: Raster, x: number, y: number, w: number, h: number, v: number) {
  for (let yy = Math.floor(y); yy < y + h; yy += 1)
    for (let xx = Math.floor(x); xx < x + w; xx += 1) {
      const i = (yy * img.width + xx) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
}
function disc(img: Raster, cx: number, cy: number, r: number, v: number) {
  for (let yy = Math.floor(cy - r); yy <= cy + r; yy += 1)
    for (let xx = Math.floor(cx - r); xx <= cx + r; xx += 1)
      if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) {
        const i = (yy * img.width + xx) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
}
// The printer draws an outline ring for every bubble; the scanner's glare gate
// verifies those outlines survived, so the harness must print them too.
function ring(img: Raster, cx: number, cy: number, r: number, v: number, thickness: number) {
  const rOut = r + thickness / 2;
  const rIn = r - thickness / 2;
  for (let yy = Math.floor(cy - rOut); yy <= cy + rOut; yy += 1)
    for (let xx = Math.floor(cx - rOut); xx <= cx + rOut; xx += 1) {
      const d2 = (xx - cx) ** 2 + (yy - cy) ** 2;
      if (d2 <= rOut * rOut && d2 >= rIn * rIn) {
        const i = (yy * img.width + xx) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
    }
}

export function renderFilledSheet(): Raster {
  const sheetW = Math.round(SHEET_W * S);
  const sheetH = Math.round(SHEET_H * S);
  const img = whiteSheet(sheetW, sheetH);
  const template = buildTemplate(ITEM_COUNT);

  const payload = qrText(buildQrPayload(ASSESSMENT_ID, LEARNER, VERSION, ITEM_COUNT));
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const mod = Math.floor((QR_ZONE.w * S) / (size + 8));
  const ox = Math.round(QR_ZONE.x * S + (QR_ZONE.w * S - mod * size) / 2);
  const oy = Math.round(QR_ZONE.y * S + (QR_ZONE.h * S - mod * size) / 2);
  for (let r = 0; r < size; r += 1)
    for (let c = 0; c < size; c += 1)
      if (qr.modules.data[r * size + c]) rect(img, ox + c * mod, oy + r * mod, mod, mod, INK_BLACK);

  MARKER_RECTS.forEach((m) => rect(img, m.x * S, m.y * S, m.w * S, m.h * S, INK_BLACK));

  const OUTLINE_INK = 95; // like the printed #475569 stroke
  template.bubbles.forEach((b) => ring(img, b.cx * S, b.cy * S, b.r * S, OUTLINE_INK, Math.max(2, 2 * S)));
  template.versionBubbles.forEach((v) => ring(img, v.cx * S, v.cy * S, v.r * S, OUTLINE_INK, Math.max(2, 2 * S)));

  const vb = template.versionBubbles.find((v) => v.version === VERSION)!;
  disc(img, vb.cx * S, vb.cy * S, vb.r * S * 0.8, INK_BLACK);

  SHADED.forEach((letter, i) => {
    const ci = ["A", "B", "C", "D", "E"].indexOf(letter);
    const bubble = template.bubbles.find((b) => b.item === i + 1 && b.choiceIndex === ci)!;
    disc(img, bubble.cx * S, bubble.cy * S, bubble.r * S * 0.8, INK_BLACK);
  });
  return img;
}

// Center the sheet on a landscape gray "desk" frame sized like the camera feed.
export function renderCameraFrame(): Raster {
  const frame: Raster = {
    data: new Uint8ClampedArray(CAMERA_W * CAMERA_H * 4).fill(255),
    width: CAMERA_W,
    height: CAMERA_H,
  };
  for (let i = 0; i < frame.data.length; i += 4) {
    frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = 205;
  }
  const sheet = renderFilledSheet();
  const ox = Math.floor((CAMERA_W - sheet.width) / 2);
  const oy = Math.floor((CAMERA_H - sheet.height) / 2);
  for (let y = 0; y < sheet.height; y += 1) {
    const src = y * sheet.width * 4;
    const dst = ((y + oy) * CAMERA_W + ox) * 4;
    frame.data.set(sheet.data.subarray(src, src + sheet.width * 4), dst);
  }
  // Deterministic sensor noise: a real camera never delivers mathematically
  // flat regions, and the blur gate (mean abs gradient) rightly rejects them.
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < frame.data.length; i += 4) {
    const n = Math.round((rand() - 0.5) * 10);
    const v = frame.data[i] + n;
    frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return frame;
}

// Chromium's fake camera plays uncompressed Y4M. Grayscale content, so the
// chroma planes are flat 128 and luma is the red channel (C420jpeg full range).
export function writeY4m(img: Raster, frames: number): string {
  const { width: w, height: h } = img;
  const header = `YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`;
  const y = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i += 1) y[i] = img.data[i * 4];
  const chroma = Buffer.alloc((w / 2) * (h / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  const file = Buffer.concat([Buffer.from(header), ...Array.from({ length: frames }, () => frame)]);
  const path = join(mkdtempSync(join(tmpdir(), "smartscan-cam-")), "sheet.y4m");
  writeFileSync(path, file);
  return path;
}

// ---------- real pairing session against the configured Supabase project ----------

function supabaseEnv(): { url: string; key: string } {
  const txt = readFileSync(".env.local", "utf8");
  const url = /^VITE_SUPABASE_URL=(.+)$/m.exec(txt)?.[1]?.trim();
  const key = /^VITE_SUPABASE_ANON_KEY=(.+)$/m.exec(txt)?.[1]?.trim();
  if (!url || !key) throw new Error("Supabase env missing — phone E2E needs .env.local");
  return { url, key };
}

export interface Teacher {
  url: string;
  key: string;
  accessToken: string;
  userId: string;
}

export async function anonymousTeacher(): Promise<Teacher> {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await res.json()) as { access_token?: string; user?: { id?: string } };
  if (!res.ok || !body.access_token || !body.user?.id) {
    throw new Error(`anonymous sign-in failed (${res.status})`);
  }
  return { url, key, accessToken: body.access_token, userId: body.user.id };
}

export async function createPairingSession(teacher: Teacher): Promise<{ sessionId: string; token: string }> {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const res = await fetch(`${teacher.url}/rest/v1/rpc/create_smartscan_pairing_session`, {
    method: "POST",
    headers: {
      apikey: teacher.key,
      Authorization: `Bearer ${teacher.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_assessment_id: ASSESSMENT_ID,
      p_pairing_token_hash: hash,
      p_learner_ids: [LEARNER.id],
      p_allowed_versions: [VERSION],
      p_item_count: ITEM_COUNT,
    }),
  });
  const rows = (await res.json()) as Array<{ session_id?: string }>;
  const sessionId = Array.isArray(rows) ? rows[0]?.session_id : undefined;
  if (!res.ok || !sessionId) throw new Error(`create_smartscan_pairing_session failed (${res.status})`);
  return { sessionId, token };
}

export async function fetchInbox(teacher: Teacher, sessionId: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(
    `${teacher.url}/rest/v1/smartscan_phone_submissions?select=*&session_id=eq.${sessionId}`,
    { headers: { apikey: teacher.key, Authorization: `Bearer ${teacher.accessToken}` } },
  );
  if (!res.ok) throw new Error(`inbox query failed (${res.status})`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

