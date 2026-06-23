import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScanImageObjectPath,
  uploadScanImageToStorage,
} from "./scanImageStorage.js";

test("buildScanImageObjectPath namespaces by user and scan", () => {
  assert.equal(
    buildScanImageObjectPath("user-1", "scan-9", "front"),
    "user-1/scan-9/front.jpg",
  );
  assert.equal(
    buildScanImageObjectPath("user-1", "scan-9", "back"),
    "user-1/scan-9/back.jpg",
  );
});

test("uploadScanImageToStorage uploads decoded JPEG bytes", async () => {
  const uploads = [];
  const supabase = {
    storage: {
      from() {
        return {
          upload(path, body, options) {
            uploads.push({ path, body, options });
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };

  const result = await uploadScanImageToStorage(supabase, {
    objectPath: "user/scan/front.jpg",
    dataUrl: "data:image/jpeg;base64,YWJj",
  });

  assert.equal(result.ok, true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].path, "user/scan/front.jpg");
  assert.equal(uploads[0].body.toString(), "97,98,99");
  assert.equal(uploads[0].options.contentType, "image/jpeg");
});

test("uploadScanImageToStorage rejects invalid payloads", async () => {
  const supabase = {
    storage: {
      from() {
        return {
          upload() {
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };

  const result = await uploadScanImageToStorage(supabase, {
    objectPath: "user/scan/front.jpg",
    dataUrl: "   ",
  });

  assert.equal(result.ok, false);
});
