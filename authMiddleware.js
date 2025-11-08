require("dotenv").config();

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader)
    return res.status(401).json({ error: "Missing Authorization header" });

  const token = authHeader.split(" ")[1];
  if (!token)
    return res
      .status(401)
      .json({ error: "Invalid Authorization header format" });

  if (token !== process.env.EXPORT_API_TOKEN)
    return res.status(403).json({ error: "Invalid or expired token" });

  next(); // ✅ Auth passed
};

module.exports = authMiddleware;
