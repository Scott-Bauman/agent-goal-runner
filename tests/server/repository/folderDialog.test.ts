import { describe, expect, it, vi } from "vitest";

import {
  FolderDialogCommandError,
  FolderDialogUnsupportedError,
  openFolderDialog,
  type DialogCommandRunner,
} from "../../../src/server/repository/folderDialog";

function commandResult(stdout = "", stderr = "", exitCode = 0) {
  return {
    stdout,
    stderr,
    exitCode,
  };
}

function enoentError(command: string) {
  return Object.assign(new Error(`${command} not found`), {
    code: "ENOENT",
  });
}

describe("folder dialog helper", () => {
  it("parses a Windows folder selection", async () => {
    const runCommand = vi.fn<DialogCommandRunner>(async () =>
      commandResult("C:\\repo\r\n"),
    );

    await expect(
      openFolderDialog({
        platform: "win32",
        runCommand,
      }),
    ).resolves.toEqual({
      cancelled: false,
      path: "C:\\repo",
    });
    expect(runCommand).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-NoProfile", "-STA", "-Command"]),
    );

    const windowsArgs = runCommand.mock.calls[0]?.[1] ?? [];
    const script = windowsArgs.at(-1) ?? "";
    const legacyDialogName = ["Folder", "Browser", "Dialog"].join("");
    const legacyFormsNamespace = ["System", "Windows", "Forms"].join(".");

    expect(script).toContain("IFileOpenDialog");
    expect(script).toContain("FOS_PICKFOLDERS");
    expect(script).toContain("FOS_FORCEFILESYSTEM");
    expect(script).toContain("FOS_PATHMUSTEXIST");
    expect(script).toContain("FOS_NOCHANGEDIR");
    expect(script).toContain("GetOptions");
    expect(script).toContain("SetOptions");
    expect(script).toContain("GetResult");
    expect(script).toContain("SIGDN_FILESYSPATH");
    expect(script).toContain("Marshal.FreeCoTaskMem");
    expect(script).toContain("HRESULT_CANCELLED");
    expect(script).toContain("0x800704C7");
    expect(script).toContain("WS_EX_TOPMOST");
    expect(script).toContain("WS_EX_TOOLWINDOW");
    expect(script).toContain("CreateWindowEx");
    expect(script).toContain("DestroyWindow");
    expect(script).toContain("dialog.Show(ownerWindow)");
    expect(script).toContain("new Thread");
    expect(script).toContain("SetApartmentState(ApartmentState.STA)");
    expect(script).not.toContain(legacyDialogName);
    expect(script).not.toContain(legacyFormsNamespace);
  });

  it("treats blank Windows output as cancellation", async () => {
    const runCommand = vi.fn(async () => commandResult("\r\n"));

    await expect(
      openFolderDialog({
        platform: "win32",
        runCommand,
      }),
    ).resolves.toEqual({
      cancelled: true,
      path: null,
    });
  });

  it("parses a macOS folder selection", async () => {
    const runCommand = vi.fn(async () => commandResult("/Users/scott/repo\n"));

    await expect(
      openFolderDialog({
        platform: "darwin",
        runCommand,
      }),
    ).resolves.toEqual({
      cancelled: false,
      path: "/Users/scott/repo",
    });
    expect(runCommand).toHaveBeenCalledWith(
      "osascript",
      expect.arrayContaining(["-e", "try"]),
    );
  });

  it("falls back from zenity to kdialog on Linux", async () => {
    const runCommand = vi.fn<DialogCommandRunner>(async (command) => {
      if (command === "zenity") {
        throw enoentError(command);
      }

      return commandResult("/home/scott/repo\n");
    });

    await expect(
      openFolderDialog({
        platform: "linux",
        runCommand,
      }),
    ).resolves.toEqual({
      cancelled: false,
      path: "/home/scott/repo",
    });
    expect(runCommand.mock.calls.map(([command]) => command)).toEqual([
      "zenity",
      "kdialog",
    ]);
  });

  it("treats a Linux nonzero exit without stderr as cancellation", async () => {
    const runCommand = vi.fn(async () => commandResult("", "", 1));

    await expect(
      openFolderDialog({
        platform: "linux",
        runCommand,
      }),
    ).resolves.toEqual({
      cancelled: true,
      path: null,
    });
  });

  it("returns an unsupported error when no Linux dialog is available", async () => {
    const runCommand = vi.fn<DialogCommandRunner>(async (command) => {
      throw enoentError(command);
    });

    await expect(
      openFolderDialog({
        platform: "linux",
        runCommand,
      }),
    ).rejects.toBeInstanceOf(FolderDialogUnsupportedError);
  });

  it("surfaces command failures with stderr", async () => {
    const runCommand = vi.fn(async () => commandResult("", "display unavailable", 1));

    await expect(
      openFolderDialog({
        platform: "win32",
        runCommand,
      }),
    ).rejects.toThrow(FolderDialogCommandError);
  });

  it("rejects unsupported platforms", async () => {
    await expect(
      openFolderDialog({
        platform: "freebsd",
        runCommand: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(FolderDialogUnsupportedError);
  });
});
