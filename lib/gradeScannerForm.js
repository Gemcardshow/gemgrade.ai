/**
 * Whether selecting a front image should reset companion upload state.
 *
 * @param {unknown} file
 * @returns {boolean}
 */
export function shouldResetCompanionImagesOnFrontChange(file) {
  return file instanceof File && file.size > 0;
}

/**
 * Clear a native file input value so FormData no longer includes the prior file.
 *
 * @param {{ value?: string } | null | undefined} input
 */
export function clearFileInputValue(input) {
  if (input && "value" in input) {
    input.value = "";
  }
}
