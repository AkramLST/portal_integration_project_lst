// authMiddleware.js
const jwt = require("jsonwebtoken");
require("dotenv").config();

const authMiddleware = (req, res, next) => {
  console.log("here");
  const authHeader = req.headers["authorization"];
  if (!authHeader)
    return res.status(401).json({ error: "Missing Authorization header" });

  const token = authHeader.split(" ")[1]; // Bearer TOKEN
  if (!token)
    return res
      .status(401)
      .json({ error: "Invalid Authorization header format" });

  jwt.verify(token, process.env.EXPORT_API_TOKEN, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
};

module.exports = authMiddleware;
