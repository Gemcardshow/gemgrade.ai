import test from "node:test";
import assert from "node:assert/strict";
import {
  clearFileInputValue,
  shouldResetCompanionImagesOnFrontChange,
} from "./gradeScannerForm.js";

test("shouldResetCompanionImagesOnFrontChange is true for non-empty files", () => {
  assert.equal(
    shouldResetCompanionImagesOnFrontChange(new File(["x"], "front.jpg")),
    true,
  );
});

test("shouldResetCompanionImagesOnFrontChange is false for empty or missing files", () => {
  assert.equal(shouldResetCompanionImagesOnFrontChange(null), false);
  assert.equal(shouldResetCompanionImagesOnFrontChange(undefined), false);
  assert.equal(
    shouldResetCompanionImagesOnFrontChange(new File([], "empty.jpg")),
    false,
  );
  assert.equal(shouldResetCompanionImagesOnFrontChange("not-a-file"), false);
});

test("clearFileInputValue clears native file input values", () => {
  const input = { value: "C:\\fakepath\\back.jpg" };
  clearFileInputValue(input);
  assert.equal(input.value, "");
});

test("clearFileInputValue ignores nullish inputs", () => {
  assert.doesNotThrow(() => {
    clearFileInputValue(null);
    clearFileInputValue(undefined);
  });
});
