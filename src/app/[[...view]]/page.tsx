import { notFound } from "next/navigation";
import { PrototypeApp } from "@/components/prototype-app";

const ROUTES = new Set([
  "",
  "tasks",
  "tasks/running",
  "tasks/result",
  "research",
  "docs",
  "evidence",
  "logs",
  "settings",
  "settings/api",
  "settings/team",
  "settings/notifications",
  "profile",
]);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ view?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const route = (await params).view?.join("/") ?? "";
  const query = await searchParams;
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  if (!ROUTES.has(route)) {
    notFound();
  }

  return (
    <PrototypeApp
      route={route}
      query={{
        productId: single(query.productId),
        taskId: single(query.taskId),
        documentId: single(query.documentId),
        followUpTaskId: single(query.followUpTaskId),
      }}
    />
  );
}
