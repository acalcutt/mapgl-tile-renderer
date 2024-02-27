import { calculateNormalizedCenterCoords } from "./tile_calculations.js";
import { generateImage } from "./generate_resources.js";

// Render the map, returning a Promise.
const renderMap = (renderer, options) => {
  renderer.render(options, (err, buffer) => {
    if (err) {
      console.error("Error during map rendering:", err);
      renderer.release();
      return reject(err);
    }
    return buffer;
  });
};

// Render map tile for a given style, zoom level, and tile coordinates
export const renderTile = (
  renderer,
  styleObject,
  ratio,
  tiletype,
  zoom,
  x,
  y,
) => {
  const tileSize = 512;

  const center = calculateNormalizedCenterCoords(x, y, zoom);

  console.log(renderer);

  renderer.load(styleObject);

  // Render the map to a buffer
  const buffer = renderMap(renderer, {
    zoom: zoom,
    center: center,
    height: tileSize,
    width: tileSize,
  });

  // Clean up the map instance to free resources
  renderer.release();

  const image = generateImage(buffer, tiletype, tileSize, tileSize, ratio);

  return image;
};
