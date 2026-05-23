const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read image file."));
    };

    image.src = objectUrl;
  });
}

function getScaledDimensions(width, height, maxDimension = MAX_DIMENSION) {
  const longestEdge = Math.max(width, height);

  if (longestEdge <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / longestEdge;

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function canvasToJpegDataUrl(canvas, quality = JPEG_QUALITY) {
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Resize and compress an image for upload while preserving card detail.
 *
 * @param {File} file
 * @param {{ maxDimension?: number, quality?: number }} [options]
 * @returns {Promise<string>} JPEG data URL
 */
export async function compressImageForUpload(
  file,
  { maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY } = {}
) {
  const image = await loadImageFromFile(file);
  const { width, height } = getScaledDimensions(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    maxDimension
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare image for upload.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  return canvasToJpegDataUrl(canvas, quality);
}

export { MAX_DIMENSION, JPEG_QUALITY };
