export default function handler(req, res) {
  const { edges, corners, surface, centering } = req.query;

  if (!edges || !corners || !surface || !centering) {
    return res.status(200).json({
      message: "Send edges, corners, surface, centering as query params",
    });
  }

  const avg =
    (parseFloat(edges) +
      parseFloat(corners) +
      parseFloat(surface) +
      parseFloat(centering)) /
    4;

  const overall = Math.round(avg * 2) / 2;

 res.status(200).json({
  edges,
  corners,
  surface,
  centering,
  finalGrade: overall
});
}
