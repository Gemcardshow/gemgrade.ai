import test from "node:test";
import assert from "node:assert/strict";
import { resolveScanImagesForGrade } from "./scanInputAdapter.js";

const FRONT = "data:image/jpeg;base64,front";
const BACK = "data:image/jpeg;base64,back";

test("Scout front-only is allowed via front-as-back approximation", () => {
  const result = resolveScanImagesForGrade({
    mode: "scout",
    frontImage: FRONT,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "scout");
  assert.equal(result.frontImage, FRONT);
  assert.equal(result.backImage, FRONT);
  assert.equal(result.scoutFrontOnlyApproximation, true);
  assert.equal(result.creditCost, 1);
});

test("Scout front+back is allowed without approximation", () => {
  const result = resolveScanImagesForGrade({
    mode: "scout",
    frontImage: FRONT,
    backImage: BACK,
  });

  assert.equal(result.ok, true);
  assert.equal(result.backImage, BACK);
  assert.equal(result.scoutFrontOnlyApproximation, false);
  assert.equal(result.creditCost, 1);
});

test("Pro front-only is blocked", () => {
  const result = resolveScanImagesForGrade({
    mode: "pro",
    frontImage: FRONT,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /Pro scans require front and back/i);
});

test("Pro front+back is allowed", () => {
  const result = resolveScanImagesForGrade({
    mode: "pro",
    frontImage: FRONT,
    backImage: BACK,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "pro");
  assert.equal(result.backImage, BACK);
  assert.equal(result.scoutFrontOnlyApproximation, false);
  assert.equal(result.creditCost, 2);
});

test("missing front image is blocked for all modes", () => {
  const scout = resolveScanImagesForGrade({ mode: "scout", frontImage: null });
  const pro = resolveScanImagesForGrade({
    mode: "pro",
    frontImage: null,
    backImage: BACK,
  });

  assert.equal(scout.ok, false);
  assert.equal(pro.ok, false);
});
