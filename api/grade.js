import OpenAI from "openai";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { frontImage, backImage, mode } = req.body || {};

    if (!frontImage || !backImage) {
      return res.status(400).json({ error: "Front and back images are required" });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const instruction =
      mode === "pro"
        ? "PRO MODE: Give full detailed breakdown including exact flaws, grading reasoning, deduction logic, why it is not a 10, and PSA prediction."
        : "FREE MODE: Give only overall grade and category scores. Do not explain details. End with: This card missed a 10 for 3 reasons. Use 1 Pro Scan to unlock the full breakdown.";

    const response = await client.responses.create({
      prompt: {
        id: "pmpt_69f1829a40bc8194b36cc144b4f96ecf04ea5212e3f1ab93",
        version: "1",
      },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instruction },
            { type: "input_image", image_url: frontImage },
            { type: "input_image", image_url: backImage }
          ],
        },
      ],
    });

    return res.status(200).json({
      result: response.output_text,
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server crashed",
    });
  }
}
