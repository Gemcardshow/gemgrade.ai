"use client";

import { useState } from "react";
import { gradeCard } from "../lib/gradeApi.js";
import GradeResult from "./GradeResult.jsx";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function GradeScanner({ mode = "free", email = "" }) {
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
      const frontImage = await readFileAsDataUrl(frontFile);
      const backImage = await readFileAsDataUrl(backFile);

      const responseGrade = await gradeCard({
        frontImage,
        backImage,
        mode,
        era: formData.get("era") || "auto",
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

        <label>
          Era
          <select name="era" defaultValue="auto">
            <option value="auto">Auto detect</option>
            <option value="vintage">Vintage</option>
            <option value="modern">Modern</option>
          </select>
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "Grading..." : mode === "pro" ? "Run Pro Scan" : "Run Free Scan"}
        </button>
      </form>

      {error ? <p className="grade-scanner__error">{error}</p> : null}
      <GradeResult grade={grade} />
    </div>
  );
}
