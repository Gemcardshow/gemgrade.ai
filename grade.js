import OpenAI from "openai";

export default async function handler(req, res) {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    const { image } = req.body;

    const response = await client.responses.create({
      prompt: {
        id: "pmpt_69f1829a40bc8194b36cc144b4f96ecf04ea5212e3f1ab93",
        version: "1",
      },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Grade this sports card image." },
            {
              type: "input_image",
              image_url: image,
            },
          ],
        },
      ],
    });

    res.status(200).json({
      result: response.output_text,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error grading card" });
  }
}
