import {
  isMissingColumnInsertError,
  parseScanImagePayload,
} from "./scanHistory.js";

export const SCAN_IMAGES_BUCKET = "scan-images";

/**
 * @param {string} userId
 * @param {string} scanId
 * @param {"front"|"back"} side
 * @returns {string}
 */
export function buildScanImageObjectPath(userId, scanId, side) {
  const fileName = side === "back" ? "back.jpg" : "front.jpg";
  return `${userId}/${scanId}/${fileName}`;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ objectPath: string, dataUrl: string }} params
 */
export async function uploadScanImageToStorage(supabase, { objectPath, dataUrl }) {
  const payload = parseScanImagePayload(dataUrl);
  if (!payload) {
    return { ok: false, error: "invalid_image" };
  }

  const { error } = await supabase.storage
    .from(SCAN_IMAGES_BUCKET)
    .upload(objectPath, payload.body, {
      contentType: payload.contentType || "image/jpeg",
      upsert: true,
    });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, path: objectPath };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} objectPath
 * @returns {Promise<{ contentType: string, body: Buffer } | null>}
 */
export async function downloadScanImageFromStorage(supabase, objectPath) {
  const { data, error } = await supabase.storage
    .from(SCAN_IMAGES_BUCKET)
    .download(objectPath);

  if (error || !data) {
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  return {
    contentType: data.type || "image/jpeg",
    body: Buffer.from(arrayBuffer),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} scanId
 * @param {string} frontImage
 * @param {string | null | undefined} backImage
 */
async function attachLegacyScanImages(supabase, scanId, frontImage, backImage) {
  const { error } = await supabase
    .from("scans")
    .update({
      front_image: frontImage,
      back_image: backImage ?? null,
    })
    .eq("id", scanId);

  return { ok: !error, reason: error?.message ?? null };
}

/**
 * Upload scan images to Storage and persist lightweight paths on the scan row.
 * Falls back to legacy base64 columns only when Storage or path columns are unavailable.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{
 *   userId: string,
 *   scanId: string,
 *   frontImage: string,
 *   backImage?: string | null,
 * }} params
 */
export async function attachScanImagesAfterInsert(
  supabase,
  { userId, scanId, frontImage, backImage = null },
) {
  if (!scanId || !userId || !frontImage) {
    return { ok: false, reason: "missing_inputs" };
  }

  const frontPath = buildScanImageObjectPath(userId, scanId, "front");
  const frontUpload = await uploadScanImageToStorage(supabase, {
    objectPath: frontPath,
    dataUrl: frontImage,
  });

  if (!frontUpload.ok) {
    const legacy = await attachLegacyScanImages(
      supabase,
      scanId,
      frontImage,
      backImage,
    );
    return {
      ok: legacy.ok,
      storage: false,
      reason: `upload:${frontUpload.error ?? "upload_failed"};legacy:${legacy.reason ?? "unknown"}`,
    };
  }

  let backPath = null;
  if (backImage) {
    const candidatePath = buildScanImageObjectPath(userId, scanId, "back");
    const backUpload = await uploadScanImageToStorage(supabase, {
      objectPath: candidatePath,
      dataUrl: backImage,
    });
    if (backUpload.ok) {
      backPath = candidatePath;
    }
  }

  const { error } = await supabase
    .from("scans")
    .update({
      front_image_path: frontPath,
      back_image_path: backPath,
    })
    .eq("id", scanId);

  if (error) {
    if (isMissingColumnInsertError(error)) {
      const legacy = await attachLegacyScanImages(
        supabase,
        scanId,
        frontImage,
        backImage,
      );
      return {
        ok: legacy.ok,
        storage: false,
        reason: "missing_path_columns",
      };
    }

    return { ok: false, storage: true, reason: error.message };
  }

  return {
    ok: true,
    storage: true,
    frontImagePath: frontPath,
    backImagePath: backPath,
  };
}
