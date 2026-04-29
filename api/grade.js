import OpenAI from "openai";

export default async function handler(req, res) {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    const { frontImage, backImage } = req.body;

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
            { type: "input_image", image_url: frontImage },
            { type: "input_image", image_url: backImage }
          ],
        },
      ],
    });

    res.status(200).json({ result: response.output_text });

  } catch (error) {
    res.status(500).json({
      error: error.message || "Error grading card"
    });
  }
}
