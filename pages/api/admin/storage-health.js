import { requireAdmin } from "../../../lib/adminAuth.js";
import { SCAN_IMAGES_BUCKET } from "../../../lib/scanImageStorage.js";
import { getServiceRoleClient } from "../../../lib/supabase/server.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) {
    return;
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return res.status(503).json({ error: "Supabase service role is not configured" });
  }

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  const bucketIds = (buckets ?? []).map((bucket) => bucket.id);
  const probePath = `_health/${admin.id}/probe.jpg`;
  const probeBytes = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAAxABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwCf/9k=",
    "base64",
  );

  const { error: uploadError } = await supabase.storage
    .from(SCAN_IMAGES_BUCKET)
    .upload(probePath, probeBytes, {
      contentType: "image/jpeg",
      upsert: true,
    });

  let downloadOk = false;
  if (!uploadError) {
    const { data, error } = await supabase.storage
      .from(SCAN_IMAGES_BUCKET)
      .download(probePath);
    downloadOk = !error && Boolean(data);
  }

  let attachResult = null;
  const scanId =
    typeof req.query.scanId === "string" ? req.query.scanId.trim() : "";
  let scanRow = null;

  if (req.query.testAttach === "1" && scanId) {
    const { attachScanImagesAfterInsert } = await import(
      "../../../lib/scanImageStorage.js"
    );
    const sampleImage =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAAxABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwCf/9k=";
    attachResult = await attachScanImagesAfterInsert(supabase, {
      userId: admin.id,
      scanId,
      frontImage: sampleImage,
      backImage: sampleImage,
    });
  }

  if (scanId) {
    const { data } = await supabase
      .from("scans")
      .select("id, front_image_path, back_image_path, front_image")
      .eq("id", Number.isFinite(Number(scanId)) ? Number(scanId) : scanId)
      .maybeSingle();
    scanRow = data;
  }

  return res.status(200).json({
    bucketIds,
    listError: listError?.message ?? null,
    targetBucket: SCAN_IMAGES_BUCKET,
    bucketPresent: bucketIds.includes(SCAN_IMAGES_BUCKET),
    uploadError: uploadError?.message ?? null,
    downloadOk,
    attachResult,
    scanRow,
  });
}
