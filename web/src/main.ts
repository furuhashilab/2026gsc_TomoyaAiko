import {
  Cartesian3,
  Color,
  Credit,
  ImageryLayer,
  Rectangle,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import aoiConfig from "../../config/aoi.sapporo.json";
import { parseAoi } from "./aoi";

const aoi = parseAoi(aoiConfig);

// GSI standard map tiles: no access token needed; attribution is required.
const gsiStandard = new UrlTemplateImageryProvider({
  url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
  maximumLevel: 18,
  credit: new Credit(
    '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
    true,
  ),
});

// No Cesium ion services: ellipsoid terrain and widgets that would call ion are disabled.
const viewer = new Viewer("cesiumContainer", {
  baseLayer: new ImageryLayer(gsiStandard),
  baseLayerPicker: false,
  geocoder: false,
  animation: false,
  timeline: false,
  sceneModePicker: false,
  navigationHelpButton: false,
});

const ring = [
  aoi.lonMin, aoi.latMin,
  aoi.lonMax, aoi.latMin,
  aoi.lonMax, aoi.latMax,
  aoi.lonMin, aoi.latMax,
  aoi.lonMin, aoi.latMin,
];
viewer.entities.add({
  name: aoi.name,
  polyline: {
    positions: Cartesian3.fromDegreesArray(ring),
    width: 3,
    material: Color.RED,
    clampToGround: true,
  },
});

viewer.camera.setView({
  destination: Rectangle.fromDegrees(aoi.lonMin - 0.005, aoi.latMin - 0.005, aoi.lonMax + 0.005, aoi.latMax + 0.005),
});
