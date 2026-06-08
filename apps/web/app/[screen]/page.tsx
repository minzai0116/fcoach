import { notFound } from "next/navigation";

import { HabitLabWireframe } from "../../components/HabitLabWireframe";
import type { ScreenKey } from "../../types/analysis";

const SCREEN_BY_ROUTE: Record<string, ScreenKey> = {
  guide: "guide",
  search: "search",
  diagnosis: "diagnosis",
  players: "players",
  habits: "habits",
  coaching: "actions",
  rankers: "rankers",
  tracking: "tracking",
};

type ScreenPageProps = {
  params: Promise<{ screen: string }>;
};

export default async function ScreenPage({ params }: ScreenPageProps) {
  const { screen } = await params;
  const initialScreen = SCREEN_BY_ROUTE[screen];

  if (!initialScreen) {
    notFound();
  }

  return <HabitLabWireframe initialScreen={initialScreen} />;
}
