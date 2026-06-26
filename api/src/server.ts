import "./otel/config";
import dotenv from "dotenv";
import express, { Express, NextFunction, Request, Response } from "express";
import { metricsMiddleware } from "./middlewares/metrics";
import searchRouter from "./routes/search";
import healthRouter from "./routes/health";
import { createClient } from 'redis';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

console.log("🔐 Token cargado:", process.env.GITHUB_TOKEN ? "✅ SÍ" : "❌ NO");
console.log("🚀 Puerto:", PORT);

const redisClient = createClient({
   url: process.env.REDIS_URL || "redis://redis:6379"
});
redisClient.on('error', err => console.error('Redis err:', err));

redisClient.connect().then(e => console.log("Redis Conected")).catch(err => { console.error('Redis err:', err); process.exit(1); });

app.use(metricsMiddleware);
app.use("/search", searchRouter);
app.use("/health", healthRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Metrics: http://localhost:9464/metrics`);
  console.log(`❤️ Health: http://localhost:${PORT}/health`);
  console.log("Prometheus URL: http://localhost:9090");
  console.log("Grafana URL:  http://localhost:3001");
  console.log("Jaeger URL http://localhost:16686/search");
});

export { app, redisClient };