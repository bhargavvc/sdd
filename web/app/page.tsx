"use client"

import dynamic from "next/dynamic"

const SDDAppShell = dynamic(
  () => import("@/components/sdd/app-shell").then((mod) => mod.SDDAppShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    ),
  },
)

export default function Page() {
  return <SDDAppShell />
}
