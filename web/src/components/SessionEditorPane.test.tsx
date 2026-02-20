// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const getFileTreeMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    getFileTree: getFileTreeMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
  },
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      aria-label="Code editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

interface MockStoreState {
  darkMode: boolean;
  sessions: Map<string, { cwd?: string }>;
  sdkSessions: { sessionId: string; cwd?: string }[];
}

let storeState: MockStoreState;

function resetStore(overrides: Partial<MockStoreState> = {}) {
  storeState = {
    darkMode: false,
    sessions: new Map([["s1", { cwd: "/repo" }]]),
    sdkSessions: [],
    ...overrides,
  };
}

vi.mock("../store.js", () => ({
  useStore: (selector: (s: MockStoreState) => unknown) => selector(storeState),
}));

import { SessionEditorPane } from "./SessionEditorPane.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe("SessionEditorPane", () => {
  it("loads tree and file content", async () => {
    // Ensures the editor initializes from existing fs endpoints without code-server.
    getFileTreeMock.mockResolvedValue({
      path: "/repo",
      tree: [
        { name: "src", path: "/repo/src", type: "directory", children: [{ name: "a.ts", path: "/repo/src/a.ts", type: "file" }] },
      ],
    });
    readFileMock.mockResolvedValue({ path: "/repo/src/a.ts", content: "const a = 1;\n" });

    render(<SessionEditorPane sessionId="s1" />);

    await waitFor(() => expect(getFileTreeMock).toHaveBeenCalledWith("/repo"));
    await waitFor(() => expect(readFileMock).toHaveBeenCalledWith("/repo/src/a.ts"));
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
  });

  it("saves when content changes", async () => {
    getFileTreeMock.mockResolvedValue({
      path: "/repo",
      tree: [{ name: "index.ts", path: "/repo/index.ts", type: "file" }],
    });
    readFileMock.mockResolvedValue({ path: "/repo/index.ts", content: "hello\n" });
    writeFileMock.mockResolvedValue({ ok: true, path: "/repo/index.ts" });

    render(<SessionEditorPane sessionId="s1" />);

    await waitFor(() => expect(readFileMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: "hello!\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalled();
      expect(writeFileMock.mock.calls[0][0]).toBe("/repo/index.ts");
    });
  });

  it("shows reconnecting message when cwd is unavailable", () => {
    resetStore({ sessions: new Map([["s1", {}]]) });
    render(<SessionEditorPane sessionId="s1" />);
    expect(screen.getByText("Editor unavailable while session is reconnecting.")).toBeInTheDocument();
  });
});
