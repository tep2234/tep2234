// Phase 11 — QR scanner placeholder.
// No camera, no jsQR yet. Manual selection / QR paste remain the workflow.

export function ScannerPlaceholder() {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-indigo-800">
        📷 Camera QR Scanner
        <span className="rounded-full bg-indigo-200 px-2 py-0.5 text-xs">
          coming soon
        </span>
      </div>
      <p className="mt-1 text-sm text-indigo-900/80">
        Camera QR scanner will be added in the next build. For now, use QR
        payload paste or manual learner selection below.
      </p>
    </div>
  );
}
