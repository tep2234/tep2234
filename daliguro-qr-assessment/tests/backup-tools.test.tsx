import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupTools } from "../src/components/BackupTools";
import { LocalDataClearError } from "../src/lib/offline-store";
import { emptyState } from "../src/lib/types";

const { clearAllLocalDataMock } = vi.hoisted(() => ({
  clearAllLocalDataMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("../src/lib/offline-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/offline-store")>();
  return { ...actual, clearAllLocalData: clearAllLocalDataMock };
});

describe("BackupTools clear all", () => {
  let container: HTMLDivElement;
  let root: Root;
  const setState = vi.fn();
  const setActiveId = vi.fn();

  beforeEach(() => {
    clearAllLocalDataMock.mockReset();
    setState.mockReset();
    setActiveId.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root.render(
        <BackupTools
          state={emptyState()}
          setState={setState}
          setActiveId={setActiveId}
        />,
      );
    });
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function clearButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Clear all data"),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("Clear button was not rendered.");
    return button;
  }

  it("awaits deletion, exposes a loading state, and prevents duplicate clicks", async () => {
    let finishDeletion: (() => void) | undefined;
    clearAllLocalDataMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDeletion = resolve;
      }),
    );

    const button = clearButton();
    flushSync(() => button.click());

    expect(clearAllLocalDataMock).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("Clearing local data");
    expect(setState).not.toHaveBeenCalled();

    button.click();
    expect(clearAllLocalDataMock).toHaveBeenCalledTimes(1);

    finishDeletion?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => undefined);

    expect(setState).toHaveBeenCalledWith(emptyState());
    expect(setActiveId).toHaveBeenCalledWith(null);
    expect(window.alert).toHaveBeenCalledWith(
      "All local DALIguro data was cleared from this browser.",
    );
  });

  it("keeps on-screen state and reports failure when any deletion area fails", async () => {
    clearAllLocalDataMock.mockRejectedValue(
      new LocalDataClearError(["assessment and scan archive"]),
    );

    flushSync(() => clearButton().click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => undefined);

    expect(setState).not.toHaveBeenCalled();
    expect(setActiveId).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(window.alert).mock.calls[0][0])).toContain("did not finish");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "assessment and scan archive",
    );
    expect(clearButton().disabled).toBe(false);
  });
});
