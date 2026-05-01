import OpenAI from "openai";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

   { type: "input_text", text: instruction },

   const { frontImage, backImage, mode } = req.body;

const instruction =
  mode === "pro"
    ? "PRO MODE: Give full detailed breakdown including exact flaws, grading reasoning, deduction logic, why it is not a 10, and PSA prediction."
    : "FREE MODE: Give only overall grade and category scores. Do not explain details.";

    if (!frontImage || !backImage) {
      return res.status(400).json({ error: "Front and back images are required" });
    }

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
{ type: "input_image", image_url: backImage },
          ],
        },
      ],
    });

    return res.status(200).json({ result: response.output_text });

  } catch (error) {
    if (!req.body) {
  return res.status(400).json({ error: "No request body" });
}
    console.error("FULL ERROR:", error);
    return res.status(500).json({
      error: error?.message || "Server crashed",
    });
  }
}
