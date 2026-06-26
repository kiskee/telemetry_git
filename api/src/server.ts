import "./otel/config";
import dotenv from "dotenv";
import express, { Express, Request, Response, NextFunction } from "express";
import axios from "axios";
import client from "prom-client";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

console.log("🔐 Token cargado:", GITHUB_TOKEN ? "✅ SÍ" : "❌ NO");
console.log("🚀 Puerto:", PORT);

// ===== PROMETHEUS METRICS =====
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 0.5, 1, 2, 5],
});

const searchRequests = new client.Counter({
  name: "github_search_requests_total",
  help: "Total GitHub search requests",
  labelNames: ["keyword", "status"],
});

const searchDuration = new client.Histogram({
  name: "github_search_duration_seconds",
  help: "Duration of GitHub searches",
  labelNames: ["keyword"],
});

// Middleware para métricas
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.path, res.statusCode.toString())
      .observe(duration);
  });

  next();
});

const SEARCH_REPOSITORIES_QUERY = `
  query SearchRepositories($query: String!, $first: Int!) {
    search(query: $query, type: REPOSITORY, first: $first) {
      repositoryCount
      edges {
        node {
          ... on Repository {
            id
            name
            description
            url
            stargazerCount
            forkCount
            primaryLanguage {
              name
            }
            createdAt
            pushedAt
          }
        }
      }
    }
  }
`;

async function searchGitHubRepos(keyword: string) {
  try {
    console.log(`🔍 Buscando "${keyword}" en GitHub...`);

    if (!GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN no está definido");
    }

    const start = Date.now();

    const response = await axios.post(
      GITHUB_GRAPHQL_URL,
      {
        query: SEARCH_REPOSITORIES_QUERY,
        variables: {
          query: keyword,
          first: 10,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const duration = (Date.now() - start) / 1000;
    searchDuration.labels(keyword).observe(duration);

    if (response.data.errors) {
      console.error("❌ GraphQL Error:", response.data.errors);
      searchRequests.labels(keyword, "error").inc();
      return null;
    }

    const data = response.data.data.search;
    console.log(`✅ Se encontraron ${data.repositoryCount} repos`);

    searchRequests.labels(keyword, "success").inc();

    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("❌ Error Status:", error.response?.status);
      console.error("❌ Error Message:", error.message);
    } else {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Error:", message);
    }
    searchRequests.labels(keyword, "error").inc();
    return null;
  }
}

app.get("/search/:keyword", async (req: Request, res: Response): Promise<void> => {
  try {
    const keyword = req.params.keyword;

    if (typeof keyword !== "string" || !keyword) {
      res.status(400).json({ error: "Valid keyword is required" });
      return;
    }

    const results = await searchGitHubRepos(keyword);

    if (!results) {
      res.status(500).json({ error: "Failed to search GitHub" });
      return;
    }

    res.status(200).json({
      keyword,
      totalCount: results.repositoryCount,
      repositories: results.edges.map((edge: any) => ({
        name: edge.node.name,
        url: edge.node.url,
        stars: edge.node.stargazerCount,
        forks: edge.node.forkCount,
        language: edge.node.primaryLanguage?.name || "Unknown",
        description: edge.node.description,
        createdAt: edge.node.createdAt,
        lastPush: edge.node.pushedAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.get("/health", (_req: Request, res: Response): void => {
  res.status(200).json({ status: "OK", timestamp: new Date() });
});

app.get("/metrics", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.set("Content-Type", client.register.contentType);
    const metrics = await client.register.metrics();
    res.status(200).end(metrics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// Error handling
app.use(
  (err: Error, req: Request, res: Response, next: NextFunction): void => {
    console.error("❌ Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Metrics: http://localhost:${PORT}/metrics`);
  console.log(`❤️ Health: http://localhost:${PORT}/health`);
  console.log("Prometheus URL: http://localhost:9090")
  console.log("Grafana URL:  http://localhost:3001")
  console.log("Jeager URL http://localhost:16686/search")
});

export { app };