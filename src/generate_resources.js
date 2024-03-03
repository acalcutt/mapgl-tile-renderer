import fs from "fs";
import path from "path";
import sharp from "sharp";
import MBTiles from "@mapbox/mbtiles";
import advancedPool from "advanced-pool";
import maplibre from "@maplibre/maplibre-gl-native";

import {
  calculateTileRangeForBounds,
  validateMinMaxValues,
} from "./tile_calculations.js";
import { renderTile } from "./render_map.js";
import { requestHandler } from "./request_resources.js";
import {
  basicMapStyle,
  openStreetMapStyle,
  protomapsStyle,
} from "./map_styles.js";

// Generate a MapGL style JSON object from a remote source
// and an additional source.
export const generateStyle = (
  style,
  overlay,
  openStreetMap,
  tileSize,
  tempDir,
) => {
  let styleObject;
  if (style === "protomaps") {
    styleObject = protomapsStyle(tempDir);
  } else if (openStreetMap) {
    styleObject = openStreetMapStyle(style, tileSize);
  } else {
    styleObject = basicMapStyle(style, tileSize);
  }
  // For now, we are styling an additional source with a
  // transparent red fill and red outline. In the future
  // we may want to allow for more customization.
  if (overlay) {
    styleObject.sources["overlay"] = {
      type: "geojson",
      data: `overlay.geojson`,
    };
    styleObject.layers.push({
      id: "polygon-layer",
      type: "fill",
      source: "overlay",
      "source-layer": "output",
      filter: ["==", "$type", "Polygon"],
      paint: {
        "fill-color": "#FF0000",
        "fill-opacity": 0.5,
      },
    });
    styleObject.layers.push({
      id: "line-layer",
      type: "line",
      source: "overlay",
      "source-layer": "output",
      filter: ["==", "$type", "LineString"],
      paint: {
        "line-color": "#FF0000",
        "line-width": 2,
      },
    });
  }
  return styleObject;
};

// Convert premultiplied image buffer from Mapbox GL to RGBA PNG format
export const generateImage = (buffer, tiletype, width, height, ratio) => {
  const image = sharp(buffer, {
    raw: {
      premultiplied: true,
      width: width * ratio,
      height: height * ratio,
      channels: 4,
    },
  });

  switch (tiletype) {
    case "jpg":
      return image.jpeg().toBuffer();
    case "png":
      return image.png().toBuffer();
    case "webp":
      return image.webp().toBuffer();
  }
};

const createPool = (styleDir, sourceDir, ratio, mode, min, max) => {
  return new advancedPool.Pool({
    min,
    max,
    create: async function (callback) {
      const resource = new maplibre.Map({
        mode,
        ratio,
        request: await requestHandler(styleDir, sourceDir),
      });
      callback(null, resource);
    },
    destroy: (renderer) => {
      renderer.release();
    },
  });
};

// Generate MBTiles file from a given style, bounds, and zoom range
export const generateMBTiles = async (
  styleObject,
  styleDir,
  sourceDir,
  bounds,
  minZoom,
  maxZoom,
  ratio,
  tiletype,
  tempDir,
  outputDir,
  outputFilename,
) => {
  const tempPath = `${tempDir}/${outputFilename}.mbtiles`;
  console.log(`Generating MBTiles file...`);

  let numberOfTiles = 0;
  let numberOfTilesWaiting = 0;
  let fileSize = 0;

  console.log(tempPath);
  new MBTiles(`${tempPath}?mode=rwc`, function (err, mbtiles) {
    console.log(mbtiles); // mbtiles object with methods listed below

    mbtiles.startWriting(function (err) {
      let metadata = {
        name: outputFilename,
        format: tiletype,
        minzoom: minZoom,
        maxzoom: maxZoom,
        type: "overlay",
      };

      // Check if metadata.json exists in the sourceDir
      const metadataFile = path.join(sourceDir, "metadata.json");
      if (fs.existsSync(metadataFile)) {
        try {
          // Read and parse the metadata.json file
          const metadataJson = fs.readFileSync(metadataFile, "utf8");
          const metadataFromFile = JSON.parse(metadataJson);

          // Merge the file metadata with the default metadata
          metadata = { ...metadata, ...metadataFromFile };
        } catch (error) {
          console.error(`Error reading metadata.json file: ${error}`);
        }
      }

      mbtiles.putInfo(metadata, (error) => {
        if (error) throw error;
      });

      console.log("Create rendering pools...");

      const minPoolSize = 1;
      const maxPoolSize = 1;
      const renderPool = createPool(
        styleDir,
        sourceDir,
        ratio,
        "tile",
        minPoolSize,
        maxPoolSize,
      );
      console.log(renderPool);

      // Iterate over zoom levels
      for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
        console.log(`Rendering zoom level ${zoom}...`);
        // Calculate tile range for this zoom level based on bounds
        const { minX, minY, maxX, maxY } = calculateTileRangeForBounds(
          bounds,
          zoom,
        );

        validateMinMaxValues(minX, minY, maxX, maxY);
        // Iterate over tiles within the range
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            numberOfTilesWaiting++;
            renderPool.acquire(async (err, renderer) => {
              console.log("rendering");
              console.log(zoom);
              console.log(x);
              console.log(y);
              if (err) {
                console.log(err);
                return;
              }

              const tileBuffer = await renderTile(
                renderer,
                styleObject,
                ratio,
                tiletype,
                zoom,
                x,
                y,
              );
              console.log("tileBuffer");
              console.log(tileBuffer);

              // Write the tile to the MBTiles file
              mbtiles.putTile(zoom, x, y, tileBuffer, (err) => {
                if (err) throw err;
              });

              // Increment the number of tiles
              numberOfTiles++;
              renderPool.release(renderer);
            });
          }
        }
      }

      mbtiles.stopWriting(function (err) {
        // stop writing to your mbtiles object
      });
    });
  });

  fileSize = fs.statSync(tempPath).size;
  //} catch (error) {
  //  throw new Error(`Error writing MBTiles file: ${error}`);
  //}

  // Move the generated MBTiles file to the output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = `${outputDir}/${outputFilename}.mbtiles`;

  try {
    const readStream = fs.createReadStream(tempPath);
    const writeStream = fs.createWriteStream(outputPath);

    readStream.on("error", (err) => {
      console.error(`Error reading MBTiles file: ${err}`);
    });

    writeStream.on("error", (err) => {
      console.error(`Error writing MBTiles file: ${err}`);
    });

    writeStream.on("close", () => {
      // Delete the temporary tiles directory and style
      if (tempDir !== null) {
        fs.promises.rm(tempDir, { recursive: true });
      }
    });

    readStream.pipe(writeStream);
  } catch (error) {
    throw new Error(`Error moving MBTiles file: ${error}`);
  }

  // Return with success status
  return {
    errorMessage: null,
    fileLocation: outputPath,
    fileSize: fileSize,
    numberOfTiles,
  };
};
