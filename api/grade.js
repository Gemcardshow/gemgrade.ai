import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { gradeCard } from "./grading/index.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  try {
    const { frontImage, backImage, mode, email, era } = req.body;

    if (!frontImage || !backImage) {
      return res.status(400).json({ error: "Missing card images" });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const grade = await gradeCard(client, {
      frontImage,
      backImage,
      mode,
      eraRequest: era || "auto",
    });

    await supabase.from("grades").insert([
      {
        email: email || null,
        grade: grade.psaGrade,
        verdict: grade.verdict,
        front_image: frontImage,
        back_image: backImage,
      },
    ]);

    return res.status(200).json(grade);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || "Error grading card",
    });
  }
}
