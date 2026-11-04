// Vehicle on the course in CesiumJS: position/orientation from track.ts, playback via the
// viewer clock, and chase / onboard-like / aerial cameras. Visualisation only.
import {
  CallbackProperty,
  Cartesian3,
  Cartographic,
  ClockRange,
  type Entity,
  HeadingPitchRange,
  HeadingPitchRoll,
  JulianDate,
  Matrix4,
  type TerrainProvider,
  Transforms,
  type Viewer,
  sampleTerrainMostDetailed,
} from "cesium";
import type { Course } from "../course";
import type { VehicleConfig } from "./config";
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
  private entity: Entity | null = null;
  private camera: CameraMode = "free";
  private camHeading = 0;
  private start = JulianDate.now();
  terrainInfo: TerrainSampleInfo | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly cfg: VehicleConfig,
  ) {
    viewer.scene.preRender.addEventListener(() => this.updateCamera());
  }

  /** Build the track for `course`, sample terrain heights, and place the vehicle at the start. */
  async load(course: Course, terrain: TerrainProvider | null): Promise<void> {
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

    this.entity = this.viewer.entities.add({
      name: "vehicle",
      position: new CallbackProperty((time) => this.positionAt(time ?? clock.currentTime), false) as never,
      orientation: new CallbackProperty((time) => {
        const s = this.stateAt(time ?? clock.currentTime);
        const hpr = new HeadingPitchRoll(s.heading + this.cfg.headingOffsetRad, s.pitch, 0);
        return Transforms.headingPitchRollQuaternion(this.positionAt(time ?? clock.currentTime), hpr);
      }, false),
      model: { uri: this.cfg.modelUri, scale: this.cfg.scale, minimumPixelSize: 24 },
    });
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
    if (this.entity) this.viewer.entities.remove(this.entity);
    this.entity = null;
    this.track = null;
  }
}
