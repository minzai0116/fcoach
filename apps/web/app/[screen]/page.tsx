import { notFound } from "next/navigation";

import { HabitLabWireframe } from "../../components/HabitLabWireframe";
import { screenFromPath } from "../../lib/uiConstants";

type ScreenPageProps = {
  params: Promise<{ screen: string }>;
};

export default async function ScreenPage({ params }: ScreenPageProps) {
  const { screen } = await params;
  const initialScreen = screenFromPath(`/${screen}`);

  if (!initialScreen) {
    notFound();
  }

  return <HabitLabWireframe initialScreen={initialScreen} />;
}
