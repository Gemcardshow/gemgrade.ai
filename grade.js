export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {

  // Fake variation for now (based on time)
  const random = () => (Math.random() * 2 + 7).toFixed(1);

  const corners = parseFloat(random());
  const edges = parseFloat(random());
  const surface = parseFloat(random());
  const centering = parseFloat(random());

  const overall = (
    (corners + edges + surface + centering) / 4
  ).toFixed(1);

  res.status(200).json({
    message: "GemGrade AI analyzing...",
    corners,
    edges,
    surface,
    centering,
    overall: parseFloat(overall)
  });
}
