// Renders children only when an active assessment is selected.
// Otherwise prompts the teacher to pick one. Shared by several panels.

import type { ReactNode } from "react";
import type { Assessment } from "../lib/types";
import { Button, Empty } from "./ui";

export function ActiveGate({
  assessments,
  activeId,
  setActiveId,
  title,
  children,
}: {
  assessments: Assessment[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  title: string;
  children: (active: Assessment) => ReactNode;
}) {
  const active = assessments.find((a) => a.id === activeId) ?? null;

  if (active) {
    return <>{children(active)}</>;
  }

  return (
    <section>
      <h1 className="text-2xl font-extrabold">{title}</h1>
      {assessments.length === 0 ? (
        <Empty text="No assessments yet. Create one in the Setup tab first." />
      ) : (
        <div>
          <p className="mt-1 text-slate-500">
            Select an assessment to work on:
          </p>
          <div className="mt-3 grid gap-2">
            {assessments.map((a) => (
              <button
                key={a.id}
                onClick={() => setActiveId(a.id)}
                className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-indigo-400"
              >
                <b>{a.title}</b>{" "}
                <span className="text-slate-500">
                  · {a.subject} · {a.section}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setActiveId(assessments[0].id)}>
              Use first assessment
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
