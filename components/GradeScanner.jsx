"use client";

import { useState } from "react";
import { compressImageForUpload } from "../lib/compressImage.js";
import { gradeCard } from "../lib/gradeApi.js";
import GradeResult from "./GradeResult.jsx";

export default function GradeScanner({ email = "" }) {
  const [grade, setGrade] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setGrade(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const frontFile = formData.get("frontImage");
    const backFile = formData.get("backImage");

    if (!(frontFile instanceof File) || !(backFile instanceof File)) {
      setError("Front and back card images are required.");
      return;
    }

    setLoading(true);

    try {
      const [frontImage, backImage] = await Promise.all([
        compressImageForUpload(frontFile),
        compressImageForUpload(backFile),
      ]);

      const responseGrade = await gradeCard({
        frontImage,
        backImage,
        email: email || undefined,
      });

      setGrade(responseGrade);
    } catch (submitError) {
      setError(submitError.message || "Unable to grade card.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grade-scanner">
      <form className="grade-scanner__form" onSubmit={handleSubmit}>
        <label>
          Front image
          <input type="file" name="frontImage" accept="image/*" required />
        </label>

        <label>
          Back image
          <input type="file" name="backImage" accept="image/*" required />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "Grading..." : "Grade Card"}
        </button>
      </form>

      {error ? <p className="grade-scanner__error">{error}</p> : null}
      <GradeResult grade={grade} />
    </div>
  );
}
