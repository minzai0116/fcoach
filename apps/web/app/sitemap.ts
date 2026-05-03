import type { MetadataRoute } from "next";

const baseUrl = "https://fcoach.fun";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/privacy", "/terms", "/license"];
  const lastModified = new Date();

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified,
    changeFrequency: route ? "monthly" : "weekly",
    priority: route ? 0.5 : 1,
  }));
}
