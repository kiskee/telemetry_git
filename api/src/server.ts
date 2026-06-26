import "./otel/config";
import dotenv from "dotenv";
import express, { Express, Request, Response, NextFunction } from "express";
import axios from "axios";
import {
  metricsMiddleware,
  searchRequestsTotal,
  searchDuration,
} from "./middlewares/metrics";
import { trace, SpanStatusCode } from "@opentelemetry/api";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

const tracer = trace.getTracer("github-analytics-api");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

console.log("🔐 Token cargado:", GITHUB_TOKEN ? "✅ SÍ" : "❌ NO");
console.log("🚀 Puerto:", PORT);

app.use(metricsMiddleware);

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
  return tracer.startActiveSpan("github.graphql.search", async (span) => {
    try {
      span.setAttribute("github.search.keyword", keyword);

      if (!GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN no está definido");
      }

      span.addEvent("http.request.start");

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
        },
      );

      span.addEvent("http.request.end");

      if (response.data.errors) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "GraphQL errors" });
        span.setAttribute("github.search.error", JSON.stringify(response.data.errors));
        searchRequestsTotal.add(1, { keyword, status: "error" });
        return null;
      }

      const data = response.data.data.search;
      span.setAttribute("github.search.repo_count", data.repositoryCount);
      span.setStatus({ code: SpanStatusCode.OK });
      searchRequestsTotal.add(1, { keyword, status: "success" });
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(error instanceof Error ? error : new Error(message));
      searchRequestsTotal.add(1, { keyword, status: "error" });
      return null;
    } finally {
      span.end();
    }
  });
}

app.get(
  "/search/:keyword",
  async (req: Request, res: Response): Promise<void> => {
    return tracer.startActiveSpan("HTTP GET /search/:keyword", async (span) => {
      try {
        const keyword = req.params.keyword;
        span.setAttribute("http.method", "GET");
        span.setAttribute("http.route", "/search/:keyword");
        span.setAttribute("search.keyword", keyword);

        if (typeof keyword !== "string" || !keyword) {
          span.setAttribute("http.status_code", 400);
          res.status(400).json({ error: "Valid keyword is required" });
          return;
        }

        const results = await searchGitHubRepos(keyword);

        if (!results) {
          span.setAttribute("http.status_code", 500);
          res.status(500).json({ error: "Failed to search GitHub" });
          return;
        }

        span.setAttribute("http.status_code", 200);
        span.setAttribute("search.result_count", results.repositoryCount);
        span.setStatus({ code: SpanStatusCode.OK });
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
        const message =
          error instanceof Error ? error.message : "Unknown error";
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(
          error instanceof Error ? error : new Error(message),
        );
        res.status(500).json({ error: message });
      } finally {
        span.end();
      }
    });
  },
);

app.get("/health", (_req: Request, res: Response): void => {
  res.status(200).json({ status: "OK", timestamp: new Date() });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Metrics: http://localhost:${PORT}/metrics`);
  console.log(`❤️ Health: http://localhost:${PORT}/health`);
  console.log("Prometheus URL: http://localhost:9090");
  console.log("Grafana URL:  http://localhost:3001");
  console.log("Jeager URL http://localhost:16686/search");
});

export { app };
