export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.status(200).json({
    message: "Image received (next step AI)",
    corners: 8.5,
    edges: 8,
    surface: 7.5,
    centering: 9,
    overall: 8
  });
}

👉 Commit again
