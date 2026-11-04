import { describe, expect, it } from "vitest";
import syntheticRaw from "../../contracts/examples/synthetic-loop.course.geojson?raw";
import { type Course, parseCourse } from "./course";
import { LatestOnly } from "./latest";
import { buildTrack, terrainSampleDistances } from "./vehicle/track";

// Two synthetic courses: the committed sample and the same loop driven as a rally.
const loop = parseCourse(JSON.parse(syntheticRaw));
const rally: Course = { ...loop, id: "synthetic-rally", mode: "rally" };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stand-in for terrain sampling: resolves after `ms` with one height per sample point.
async function prepare(course: Course, ms: number) {
  const track = buildTrack(course.coordinates, course.mode === "circuit");
  const ds = terrainSampleDistances(track, 2);
  await delay(ms);
  return { id: course.id, samples: ds.length };
}

describe("LatestOnly", () => {
  it("discards a slow earlier course when a newer one finishes first", async () => {
    const latest = new LatestOnly();
    const applied: string[] = [];
    const slow = latest.run(() => prepare(loop, 30), (r) => applied.push(r.id));
    const fast = latest.run(() => prepare(rally, 5), (r) => applied.push(r.id));
    expect(await Promise.all([slow, fast])).toEqual([false, true]);
    expect(applied).toEqual(["synthetic-rally"]);
  });

  it("keeps only the last of several rapid switches", async () => {
    const latest = new LatestOnly();
    const applied: string[] = [];
    const courses = [loop, rally, loop, rally, loop];
    const delays = [40, 10, 30, 5, 20];
    await Promise.all(courses.map((c, i) => latest.run(() => prepare(c, delays[i]), (r) => applied.push(`${r.id}#${i}`))));
    expect(applied).toEqual(["synthetic-loop#4"]);
  });

  it("applies a single load normally", async () => {
    const latest = new LatestOnly();
    let applied = "";
    expect(await latest.run(() => prepare(loop, 1), (r) => (applied = r.id))).toBe(true);
    expect(applied).toBe("synthetic-loop");
  });
});
