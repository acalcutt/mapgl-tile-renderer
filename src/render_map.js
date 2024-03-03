import { calculateNormalizedCenterCoords } from "./tile_calculations.js";
import { generateImage } from "./generate_resources.js";

// Render the map, returning a Promise.
const renderMap = async (renderer, options) => {
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
export async function renderTile(
  renderer,
  styleObject,
  ratio,
  tiletype,
  zoom,
  x,
  y,
) {
  const tileSize = 512;

  const center = calculateNormalizedCenterCoords(x, y, zoom);

  console.log("renderer");
  console.log(renderer);
  console.log("center");
  console.log(center);

  console.log("styleObject");
  //console.log(styleObject);
  renderer.load(styleObject);

  let render_options = {
    zoom: zoom,
    center: center,
    height: tileSize,
    width: tileSize,
  };

  await renderer.render(render_options, (err, buffer) => {
    if (err) throw err;

    map.release();

    console.log("buffer");
    console.log(buffer);
    const image = generateImage(buffer, tiletype, tileSize, tileSize, ratio);

    return image;
  });
}
