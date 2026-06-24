// Teacher-first onboarding shown on the Setup tab when no assessment exists.
// 5 plain steps + a one-tap demo loader so a teacher can try the whole flow.

import type { PanelProps } from "./panel-types";
import { buildDemoBundle, withDemoBundle } from "../lib/demo";
import { Button } from "./ui";

const STEPS: [string, string][] = [
  ["Create assessment", "Add a title, subject, section, and test versions."],
  ["Add items & answer key", "Encode each question, then set the correct answers per version."],
  ["Add learners", "Type them in, or import a class list as CSV."],
  ["Generate QR sheets", "Print one identity QR per learner. The QR holds no answers."],
  ["Scan QR & check", "Scan to pull up the learner, then mark answers and save the score."],
];

export function StartGuide({
  setState,
  setActiveId,
  onCreate,
}: {
  setState: PanelProps["setState"];
  setActiveId: PanelProps["setActiveId"];
  onCreate: () => void;
}) {
  function loadDemo() {
    const bundle = buildDemoBundle();
    setState((prev) => withDemoBundle(prev, bundle));
    setActiveId(bundle.assessment.id);
  }

  return (
    <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
      <h2 className="text-lg font-extrabold text-indigo-900">
        👋 Welcome — here is the 5-step flow
      </h2>
      <ol className="mt-3 grid gap-2">
        {STEPS.map(([title, detail], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-indigo-700 text-sm font-extrabold text-white">
              {i + 1}
            </span>
            <span className="text-sm text-indigo-900">
              <b>{title}.</b> {detail}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onCreate}>+ Create my first assessment</Button>
        <Button variant="ghost" onClick={loadDemo}>
          ⚡ Load demo assessment
        </Button>
      </div>
      <p className="mt-2 text-xs text-indigo-900/70">
        The demo adds 1 assessment, 10 items, an answer key, and 5 learners
        (versions A &amp; B) so you can try checking right away. All data stays
        on this device.
      </p>
    </div>
  );
}
