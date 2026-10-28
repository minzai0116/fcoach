import type { MetadataRoute } from "next";

const baseUrl = "https://fcoach.fun";

const routes = [
  { path: "/guide", frequency: "weekly", priority: 0.5 },
  { path: "/search", frequency: "weekly", priority: 1 },
  { path: "/diagnosis", frequency: "weekly", priority: 0.8 },
  { path: "/players", frequency: "weekly", priority: 0.8 },
  { path: "/matches", frequency: "weekly", priority: 0.8 },
  { path: "/coaching", frequency: "weekly", priority: 0.8 },
  { path: "/rankers", frequency: "weekly", priority: 0.8 },
  { path: "/tracking", frequency: "weekly", priority: 0.8 },
  { path: "/privacy", frequency: "monthly", priority: 0.5 },
  { path: "/terms", frequency: "monthly", priority: 0.5 },
  { path: "/license", frequency: "monthly", priority: 0.5 },
] satisfies Array<{
  path: string;
  frequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}>;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map((route) => ({
    url: `${baseUrl}${route.path}`,
    lastModified,
    changeFrequency: route.frequency,
    priority: route.priority,
  }));
}
