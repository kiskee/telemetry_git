import axios from "axios";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { searchRequestsTotal } from "../middlewares/metrics";

const tracer = trace.getTracer("github-analytics-api");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

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

export interface GitHubRepo {
  name: string;
  url: string;
  stars: number;
  forks: number;
  language: string;
  description: string;
  createdAt: string;
  lastPush: string;
}

export interface SearchResult {
  keyword: string;
  totalCount: number;
  repositories: GitHubRepo[];
}

export async function searchGitHubRepos(keyword: string): Promise<SearchResult | null> {
  return tracer.startActiveSpan("github.graphql.search", async (span) => {
    try {
      span.setAttribute("github.search.keyword", keyword);

      if (!GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN no está definido");
      }

      const response = await axios.post(
        GITHUB_GRAPHQL_URL,
        {
          query: SEARCH_REPOSITORIES_QUERY,
          variables: { query: keyword, first: 10 },
        },
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );

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

      return {
        keyword,
        totalCount: data.repositoryCount,
        repositories: data.edges.map((edge: any) => ({
          name: edge.node.name,
          url: edge.node.url,
          stars: edge.node.stargazerCount,
          forks: edge.node.forkCount,
          language: edge.node.primaryLanguage?.name || "Unknown",
          description: edge.node.description,
          createdAt: edge.node.createdAt,
          lastPush: edge.node.pushedAt,
        })),
      };
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