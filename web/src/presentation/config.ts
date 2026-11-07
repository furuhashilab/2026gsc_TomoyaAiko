// Race-presentation settings (config/presentation/*.json): a fictional street-race look for
// a hand-picked part of one course. Everything is placed by course distance s (m), so the
// same recipe shape can later be applied to other (generated) courses.

export type Side = "left" | "right";

export interface Range {
  fromS: number;
  toS: number;
}

export interface Sponsor {
  text: string;
  bg: string;
  fg: string;
}

export interface PresentationConfig {
  courseId: string;
  name: string;
  disclaimer: string;
  sampleStepM: number;
  headingWindowM: number;
  road: Range & { widthM: number; liftM: number; kerbWidthM: number; lineWidthM: number; textureRepeatM: number };
  barriers: {
    heightM: number;
    thicknessM: number;
    gapFromRoadM: number;
    fenceHeightM: number;
    sections: (Range & { side: Side })[];
  };
  ads: {
    lengthM: number;
    heightM: number;
    subText: string;
    panels: { side: Side; s: number; sponsor: Sponsor }[];
  };
}

function fail(message: string): never {
  throw new Error(`Invalid presentation config: ${message}`);
}

function num(v: unknown, what: string, min = 0): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) fail(`${what} must be a number >= ${min}`);
  return v;
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || !v) fail(`${what} is required`);
  return v;
}

function side(v: unknown, what: string): Side {
  if (v !== "left" && v !== "right") fail(`${what} must be "left" or "right"`);
  return v;
}

function range(r: Record<string, unknown>, what: string): Range {
  const fromS = num(r.from_s, `${what}.from_s`);
  const toS = num(r.to_s, `${what}.to_s`);
  if (toS <= fromS) fail(`${what}.to_s must be greater than from_s`);
  return { fromS, toS };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function parsePresentation(data: unknown): PresentationConfig {
  const d = data as Record<string, Record<string, unknown>>;
  if ((d?.schema as unknown) !== "circuitforge-presentation") fail("schema must be circuitforge-presentation");
  const road = d.road ?? fail("road is required");
  const b = d.barriers ?? fail("barriers is required");
  const a = d.ads ?? fail("ads is required");
  const roadRange = range(road, "road");
  const width = num(road.width_m, "road.width_m", 1);
  const kerb = num(road.kerb_width_m, "road.kerb_width_m");
  const line = num(road.line_width_m, "road.line_width_m");
  if (2 * (kerb + line) >= width) fail("road kerbs and lines must fit inside road.width_m");
  const inRoad = (r: Range, what: string) => {
    if (r.fromS < roadRange.fromS || r.toS > roadRange.toS) fail(`${what} must lie inside the road range`);
  };

  const sections = ((b.sections as Record<string, unknown>[] | undefined) ?? fail("barriers.sections is required")).map((s, i) => {
    const r = { ...range(s, `barriers.sections[${i}]`), side: side(s.side, `barriers.sections[${i}].side`) };
    inRoad(r, `barriers.sections[${i}]`);
    return r;
  });

  const sponsors = (a.sponsors as Record<string, Record<string, unknown>> | undefined) ?? fail("ads.sponsors is required");
  const lengthM = num(a.length_m, "ads.length_m", 0.5);
  const panels = ((a.panels as Record<string, unknown>[] | undefined) ?? fail("ads.panels is required")).map((p, i) => {
    const what = `ads.panels[${i}]`;
    const sp = sponsors[str(p.sponsor, `${what}.sponsor`)] ?? fail(`${what}.sponsor is not in ads.sponsors`);
    const sponsor = { text: str(sp.text, "sponsor.text"), bg: str(sp.bg, "sponsor.bg"), fg: str(sp.fg, "sponsor.fg") };
    if (!COLOR.test(sponsor.bg) || !COLOR.test(sponsor.fg)) fail(`${what} sponsor colours must be #rrggbb`);
    const s = num(p.s, `${what}.s`);
    const ps = side(p.side, `${what}.side`);
    // an ad hangs on a barrier, so the whole panel must be on one barrier section
    if (!sections.some((r) => r.side === ps && r.fromS <= s - lengthM / 2 && s + lengthM / 2 <= r.toS)) {
      fail(`${what} must lie on a barrier section of the same side`);
    }
    return { side: ps, s, sponsor };
  });

  const barrierH = num(b.height_m, "barriers.height_m", 0.1);
  const fenceH = num(b.fence_height_m, "barriers.fence_height_m");
  if (fenceH !== 0 && fenceH <= barrierH) fail("barriers.fence_height_m must be 0 (no fence) or above barriers.height_m");
  const adH = num(a.height_m, "ads.height_m", 0.1);
  // panels start 0.1 m above the ground (geometry.ts) and must stay on the barrier face
  if (adH + 0.1 > barrierH) fail("ads.height_m must fit on the barrier face");

  return {
    courseId: str(d.course_id, "course_id"),
    name: str(d.name, "name"),
    disclaimer: str(d.disclaimer, "disclaimer"),
    sampleStepM: num(d.sample_step_m, "sample_step_m", 0.5),
    headingWindowM: num(d.heading_window_m, "heading_window_m", 0),
    road: {
      ...roadRange,
      widthM: width,
      liftM: num(road.lift_m, "road.lift_m"),
      kerbWidthM: kerb,
      lineWidthM: line,
      textureRepeatM: num(road.texture_repeat_m, "road.texture_repeat_m", 1),
    },
    barriers: {
      heightM: barrierH,
      thicknessM: num(b.thickness_m, "barriers.thickness_m", 0.05),
      gapFromRoadM: num(b.gap_from_road_m, "barriers.gap_from_road_m"),
      fenceHeightM: fenceH,
      sections,
    },
    ads: { lengthM, heightM: adH, subText: str(a.sub_text, "ads.sub_text"), panels },
  };
}
