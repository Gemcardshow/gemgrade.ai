import OpenAI from "openai";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const { frontImage, backImage } = req.body || {};

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
            { type: "input_text", text: "FREE MODE: Grade this card using both images." },
            { type: "input_image", image_base64: frontImage }, // 👈 use base64 field
            { type: "input_image", image_base64: backImage },
          ],
        },
      ],
    });

    return res.status(200).json({ result: response.output_text });

  } catch (error) {
    console.error("FULL ERROR:", error);
    return res.status(500).json({
      error: error?.message || "Server crashed",
    });
  }
}
