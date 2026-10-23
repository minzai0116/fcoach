"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { analyticsEnabled, beforeSendAnalytics, trackPageView } from "../lib/analytics";

export function ServiceAnalytics() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { setEnabled(analyticsEnabled()); trackPageView(); }, [pathname]);
  return enabled ? <Analytics beforeSend={beforeSendAnalytics} /> : null;
}
