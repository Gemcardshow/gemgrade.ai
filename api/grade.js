export default async function handler(req, res) {
  res.status(200).json({
    message: "GemGrade AI endpoint is working 🔥",
    corners: 8.5,
    edges: 8.0,
    surface: 7.5,
    centering: 9.0,
    overall: 8.0
  });
}
