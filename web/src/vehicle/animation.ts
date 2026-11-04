// Vehicle on the course in CesiumJS: position/orientation from track.ts, playback via the
// viewer clock, and chase / onboard-like / aerial cameras. Visualisation only.
import {
  CallbackProperty,
  Cartesian3,
  Cartographic,
  ClockRange,
  Color,
  type Entity,
  HeadingPitchRange,
  HeadingPitchRoll,
  JulianDate,
  Matrix4,
  Model,
  type TerrainProvider,
  Transforms,
  type Viewer,
  sampleTerrainMostDetailed,
} from "cesium";
import type { Course } from "../course";
import { LatestOnly } from "../latest";
import type { VehicleConfig } from "./config";
import { checkModelResources } from "./model-check";
import {
  angleDiff,
  buildTrack,
  distanceAtTime,
  headingAt,
  heightAt,
  lonLatAt,
  pitchAt,
  type Track,
  terrainSampleDistances,
} from "./track";

export type CameraMode = "free" | "chase" | "onboard" | "aerial";

export interface VehicleState {
  distance: number;
  lap: number;
  lon: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
}

/**
 * What is drawn for the vehicle: the configured model ("loading" until CesiumJS reports it
 * ready), or the simple fallback shape when the model or its texture failed.
 */
export interface VehicleVisual {
  kind: "loading" | "model" | "fallback";
  reason?: string;
}

export interface TerrainSampleInfo {
  samples: number;
  stepM: number;
  ms: number;
  source: "terrain" | "ellipsoid";
}

export class VehicleAnimation {
  private track: Track | null = null;
  private sampleD: number[] = [];
  private heights: number[] = [];
  private model: Model | null = null;
  private fallback: Entity[] = [];
  private readonly loads = new LatestOnly();
  visual: VehicleVisual | null = null;
  private camera: CameraMode = "free";
  private camHeading = 0;
  private start = JulianDate.now();
  terrainInfo: TerrainSampleInfo | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly cfg: VehicleConfig,
  ) {
    viewer.scene.preRender.addEventListener(() => {
      this.updateModelMatrix();
      this.updateCamera();
    });
  }

  /**
   * Build the track for `course`, sample terrain heights, and place the vehicle at the start.
   * Returns false if a newer `load` started meanwhile (its result wins; this one is dropped).
   */
  async load(course: Course, terrain: TerrainProvider | null, modelUri = this.cfg.modelUri): Promise<boolean> {
    const generation = this.loads.begin();
    this.dispose();
    const track = buildTrack(course.coordinates, course.mode === "circuit");
    const ds = terrainSampleDistances(track, this.cfg.terrainStepM);
    const t0 = performance.now();
    let hs: number[];
    if (terrain) {
      const points = ds.map((d) => {
        const [lon, lat] = lonLatAt(track, d);
        return Cartographic.fromDegrees(lon, lat);
      });
      await sampleTerrainMostDetailed(terrain, points);
      if (!this.loads.isCurrent(generation)) return false;
      hs = points.map((p) => p.height);
    } else {
      hs = ds.map(() => 0); // ellipsoid, like the course line when terrain is unavailable
    }
    this.terrainInfo = { samples: ds.length, stepM: this.cfg.terrainStepM, ms: Math.round(performance.now() - t0), source: terrain ? "terrain" : "ellipsoid" };
    this.track = track;
    this.sampleD = ds;
    this.heights = hs;

    const clock = this.viewer.clock;
    this.start = JulianDate.now();
    clock.startTime = this.start.clone();
    clock.currentTime = this.start.clone();
    clock.clockRange = ClockRange.UNBOUNDED;
    clock.shouldAnimate = false;
    clock.multiplier = 1;

    const visual = await this.addModel(modelUri, generation);
    if (!this.loads.isCurrent(generation)) return false;
    this.setVisual(visual);
    return true;
  }

  private setVisual(visual: VehicleVisual): void {
    this.visual = visual;
    if (visual.kind === "fallback" && this.fallback.length === 0) this.addFallback();
  }

  // The model is a primitive (not an entity) so its load and texture errors are observable.
  private async addModel(uri: string, generation: number): Promise<VehicleVisual> {
    let model: Model | null = null;
    try {
      await checkModelResources(uri);
      if (!this.loads.isCurrent(generation)) return { kind: "fallback", reason: "superseded" };
      model = await Model.fromGltfAsync({ url: uri, scale: this.cfg.scale, minimumPixelSize: 24 });
      if (!this.loads.isCurrent(generation)) {
        model.destroy();
        return { kind: "fallback", reason: "superseded" };
      }
      this.model = this.viewer.scene.primitives.add(model) as Model;
      this.updateModelMatrix();
      // No timeout: the files passed the pre-flight check, and a slow (e.g. background-tab)
      // render must not be mistaken for a failure. Only an error switches to the fallback.
      const loaded = model;
      loaded.readyEvent.addEventListener(() => {
        if (this.model === loaded) this.setVisual({ kind: "model" });
      });
      loaded.errorEvent.addEventListener((err: { message?: string }) => {
        if (this.model !== loaded) return;
        this.viewer.scene.primitives.remove(loaded);
        this.model = null;
        this.setVisual({ kind: "fallback", reason: String(err?.message ?? err).split("\n")[0].slice(0, 160) });
      });
      return { kind: loaded.ready ? "model" : "loading" };
    } catch (e) {
      if (model && this.model === model) {
        this.viewer.scene.primitives.remove(model);
        this.model = null;
      } else if (model && !model.isDestroyed()) {
        model.destroy();
      }
      const reason = e instanceof Error ? e.message : String(e);
      return { kind: "fallback", reason: reason.split("\n")[0].slice(0, 160) };
    }
  }

  // Simple vehicle (body + nose) used when the GLB or its texture cannot be loaded.
  private addFallback(): void {
    const clock = this.viewer.clock;
    const len = 4.6;
    const orientation = new CallbackProperty((time) => {
      const s = this.stateAt(time ?? clock.currentTime);
      return Transforms.headingPitchRollQuaternion(this.positionAt(time ?? clock.currentTime), new HeadingPitchRoll(s.heading - Math.PI / 2, s.pitch, 0));
    }, false);
    const offsetPosition = (forward: number, up: number) =>
      new CallbackProperty((time) => {
        const t = time ?? clock.currentTime;
        const s = this.stateAt(t);
        const ahead = this.stateAtDistance(s.distance + forward);
        return Cartesian3.fromDegrees(ahead.lon, ahead.lat, s.height + this.cfg.groundOffsetM + up);
      }, false) as never;
    this.fallback = [
      this.viewer.entities.add({
        name: "vehicle (fallback)",
        position: offsetPosition(0, 0.5),
        orientation: orientation as never,
        box: { dimensions: new Cartesian3(len, 1.9, 1.0), material: Color.fromCssColorString("#d9481f"), outline: true, outlineColor: Color.BLACK },
      }),
      this.viewer.entities.add({
        name: "vehicle nose (fallback)",
        position: offsetPosition(len / 2 + 0.4, 0.35),
        orientation: orientation as never,
        box: { dimensions: new Cartesian3(0.8, 1.0, 0.5), material: Color.fromCssColorString("#ffd400") },
      }),
    ];
  }

  private updateModelMatrix(): void {
    if (!this.model || !this.track) return;
    if (this.visual?.kind === "loading" && this.model.ready) this.setVisual({ kind: "model" });
    const t = this.viewer.clock.currentTime;
    const s = this.stateAt(t);
    const hpr = new HeadingPitchRoll(s.heading + this.cfg.headingOffsetRad, s.pitch, 0);
    this.model.modelMatrix = Transforms.headingPitchRollToFixedFrame(this.positionAt(t), hpr);
  }

  /** Use ellipsoid heights (called when the terrain is dropped after loading). */
  useEllipsoidHeights(): void {
    this.heights = this.heights.map(() => 0);
    if (this.terrainInfo) this.terrainInfo.source = "ellipsoid";
  }

  stateAt(time: JulianDate): VehicleState {
    const track = this.track as Track;
    const seconds = JulianDate.secondsDifference(time, this.start);
    const travelled = seconds * this.cfg.baseSpeedMps;
    const d = distanceAtTime(track, seconds, this.cfg.baseSpeedMps);
    const [lon, lat] = lonLatAt(track, d);
    return {
      distance: d,
      lap: track.closed ? Math.floor(travelled / track.length) + 1 : 1,
      lon,
      lat,
      height: heightAt(track, this.sampleD, this.heights, d),
      heading: headingAt(track, d, this.cfg.headingWindowM),
      pitch: pitchAt(track, this.sampleD, this.heights, d, this.cfg.pitchWindowM),
    };
  }

  /** State at a distance along the track (same clock-independent maths as stateAt). */
  stateAtDistance(distance: number): VehicleState {
    const seconds = distance / this.cfg.baseSpeedMps;
    return this.stateAt(JulianDate.addSeconds(this.start, seconds, new JulianDate()));
  }

  positionAt(time: JulianDate): Cartesian3 {
    const s = this.stateAt(time);
    return Cartesian3.fromDegrees(s.lon, s.lat, s.height + this.cfg.groundOffsetM);
  }

  get ready(): boolean {
    return this.track !== null;
  }

  get length(): number {
    return this.track?.length ?? 0;
  }

  play(): void {
    this.viewer.clock.shouldAnimate = true;
  }

  pause(): void {
    this.viewer.clock.shouldAnimate = false;
  }

  reset(): void {
    this.viewer.clock.currentTime = this.start.clone();
  }

  setMultiplier(m: number): void {
    this.viewer.clock.multiplier = m;
  }

  setCamera(mode: CameraMode): void {
    this.camera = mode;
    if (mode === "free") this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    else if (this.track) this.camHeading = this.stateAt(this.viewer.clock.currentTime).heading;
  }

  current(): VehicleState | null {
    return this.track ? this.stateAt(this.viewer.clock.currentTime) : null;
  }

  private updateCamera(): void {
    if (!this.track || this.camera === "free") return;
    const s = this.stateAt(this.viewer.clock.currentTime);
    const target = Cartesian3.fromDegrees(s.lon, s.lat, s.height + this.cfg.groundOffsetM + 1);
    const cams = this.cfg.cameras;
    if (this.camera === "chase") {
      // low-pass filter on the camera heading so corners do not jerk the view
      this.camHeading += angleDiff(s.heading, this.camHeading) * cams.chase.smoothing;
      this.viewer.camera.lookAt(target, new HeadingPitchRange(this.camHeading, cams.chase.pitchRad, cams.chase.rangeM));
    } else if (this.camera === "aerial") {
      this.viewer.camera.lookAt(target, new HeadingPitchRange(0, cams.aerial.pitchRad, cams.aerial.rangeM));
    } else {
      // "onboard-like": just ahead of the nose, looking along the travel direction
      const ahead = this.stateAt(JulianDate.addSeconds(this.viewer.clock.currentTime, cams.onboardLike.forwardM / this.cfg.baseSpeedMps, new JulianDate()));
      this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      this.viewer.camera.setView({
        destination: Cartesian3.fromDegrees(ahead.lon, ahead.lat, ahead.height + cams.onboardLike.heightM),
        orientation: { heading: s.heading, pitch: cams.onboardLike.pitchRad, roll: 0 },
      });
    }
  }

  dispose(): void {
    if (this.model) this.viewer.scene.primitives.remove(this.model);
    this.model = null;
    for (const e of this.fallback) this.viewer.entities.remove(e);
    this.fallback = [];
    this.visual = null;
    this.track = null;
  }
}
