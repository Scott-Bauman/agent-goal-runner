import { spawn } from "node:child_process";
import os from "node:os";

import { isNodeErrorCode } from "../shared/nodeErrors.js";

export type FolderDialogResult =
  | {
      cancelled: false;
      path: string;
    }
  | {
      cancelled: true;
      path: null;
    };

export type DialogCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type DialogCommandRunner = (
  command: string,
  args: string[],
) => Promise<DialogCommandResult>;

export class FolderDialogUnsupportedError extends Error {
  constructor(message = "Folder picker is not supported on this system.") {
    super(message);
    this.name = "FolderDialogUnsupportedError";
  }
}

export class FolderDialogCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderDialogCommandError";
  }
}

function trimSelectedPath(output: string): string | null {
  const selectedPath = output.trim();

  return selectedPath.length > 0 ? selectedPath : null;
}

async function runDialogCommand(
  command: string,
  args: string[],
): Promise<DialogCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
      });
    });
  });
}

function commandFailureMessage(command: string, result: DialogCommandResult) {
  const stderr = result.stderr.trim();

  return stderr.length > 0
    ? `${command} failed: ${stderr}`
    : `${command} failed with exit code ${result.exitCode ?? "unknown"}.`;
}

async function openWindowsFolderDialog(
  runCommand: DialogCommandRunner,
): Promise<FolderDialogResult> {
  const dialogScript = String.raw`
$source = @'
using System;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Threading;

namespace CodexRunner
{
    public static class FolderPicker
    {
        private const uint FOS_PICKFOLDERS = 0x00000020;
        private const uint FOS_FORCEFILESYSTEM = 0x00000040;
        private const uint FOS_PATHMUSTEXIST = 0x00000800;
        private const uint FOS_NOCHANGEDIR = 0x00000008;
        private const uint SIGDN_FILESYSPATH = 0x80058000;
        private const int HRESULT_CANCELLED = unchecked((int)0x800704C7);
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int WS_EX_TOPMOST = 0x00000008;
        private const int WS_POPUP = unchecked((int)0x80000000);

        public static string Show()
        {
            string selectedPath = null;
            Exception dialogError = null;
            var dialogThread = new Thread(() =>
            {
                try
                {
                    selectedPath = ShowOnStaThread();
                }
                catch (Exception error)
                {
                    dialogError = error;
                }
            });

            dialogThread.SetApartmentState(ApartmentState.STA);
            dialogThread.Start();
            dialogThread.Join();

            if (dialogError != null)
            {
                ExceptionDispatchInfo.Capture(dialogError).Throw();
            }

            return selectedPath ?? string.Empty;
        }

        private static string ShowOnStaThread()
        {
            var dialog = (IFileOpenDialog)new FileOpenDialog();
            IntPtr ownerWindow = IntPtr.Zero;

            try
            {
                ownerWindow = CreateTopmostOwnerWindow();

                uint options;
                dialog.GetOptions(out options);
                dialog.SetOptions(
                    options |
                    FOS_PICKFOLDERS |
                    FOS_FORCEFILESYSTEM |
                    FOS_PATHMUSTEXIST |
                    FOS_NOCHANGEDIR
                );
                dialog.SetTitle("Choose a git repository folder");

                int result = dialog.Show(ownerWindow);

                if (result == HRESULT_CANCELLED)
                {
                    return null;
                }

                if (result != 0)
                {
                    Marshal.ThrowExceptionForHR(result);
                }

                IShellItem item;
                dialog.GetResult(out item);

                IntPtr pathPointer = IntPtr.Zero;

                try
                {
                    item.GetDisplayName(SIGDN_FILESYSPATH, out pathPointer);
                    return Marshal.PtrToStringUni(pathPointer);
                }
                finally
                {
                    if (pathPointer != IntPtr.Zero)
                    {
                        Marshal.FreeCoTaskMem(pathPointer);
                    }

                    if (item != null)
                    {
                        Marshal.ReleaseComObject(item);
                    }
                }
            }
            finally
            {
                if (ownerWindow != IntPtr.Zero)
                {
                    DestroyWindow(ownerWindow);
                }

                Marshal.ReleaseComObject(dialog);
            }
        }

        private static IntPtr CreateTopmostOwnerWindow()
        {
            return CreateWindowEx(
                WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
                "STATIC",
                string.Empty,
                WS_POPUP,
                0,
                0,
                0,
                0,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero
            );
        }

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateWindowEx(
            int extendedStyle,
            string className,
            string windowName,
            int style,
            int x,
            int y,
            int width,
            int height,
            IntPtr parent,
            IntPtr menu,
            IntPtr instance,
            IntPtr param
        );

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyWindow(IntPtr window);
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    internal class FileOpenDialog
    {
    }

    [ComImport]
    [Guid("d57c7288-d4ad-4768-be02-9d969532d960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileOpenDialog
    {
        [PreserveSig]
        int Show(IntPtr parent);
        void SetFileTypes(uint fileTypes, IntPtr filterSpec);
        void SetFileTypeIndex(uint fileType);
        void GetFileTypeIndex(out uint fileType);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem item);
        void SetFolder(IShellItem item);
        void GetFolder(out IShellItem item);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, uint alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string defaultExtension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport]
    [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        void BindToHandler(IntPtr bindContext, ref Guid handlerId, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint displayName, out IntPtr name);
        void GetAttributes(uint attributeMask, out uint attributes);
        void Compare(IShellItem item, uint hint, out int order);
    }
}
'@

Add-Type -TypeDefinition $source
$selectedPath = [CodexRunner.FolderPicker]::Show()
if ($selectedPath.Length -gt 0) {
    [Console]::WriteLine($selectedPath)
}
`;
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-STA",
    "-Command",
    dialogScript,
  ]);

  if (result.exitCode !== 0) {
    throw new FolderDialogCommandError(commandFailureMessage("powershell.exe", result));
  }

  const selectedPath = trimSelectedPath(result.stdout);

  return selectedPath
    ? { cancelled: false, path: selectedPath }
    : { cancelled: true, path: null };
}

async function openMacFolderDialog(
  runCommand: DialogCommandRunner,
): Promise<FolderDialogResult> {
  const result = await runCommand("osascript", [
    "-e",
    "try",
    "-e",
    "set selectedFolder to choose folder with prompt \"Choose a git repository folder\"",
    "-e",
    "POSIX path of selectedFolder",
    "-e",
    "on error number -128",
    "-e",
    "return \"\"",
    "-e",
    "end try",
  ]);

  if (result.exitCode !== 0) {
    throw new FolderDialogCommandError(commandFailureMessage("osascript", result));
  }

  const selectedPath = trimSelectedPath(result.stdout);

  return selectedPath
    ? { cancelled: false, path: selectedPath }
    : { cancelled: true, path: null };
}

async function tryOpenLinuxDialog(
  command: "zenity" | "kdialog",
  args: string[],
  runCommand: DialogCommandRunner,
): Promise<FolderDialogResult | "missing"> {
  try {
    const result = await runCommand(command, args);

    if (result.exitCode === 0) {
      const selectedPath = trimSelectedPath(result.stdout);

      return selectedPath
        ? { cancelled: false, path: selectedPath }
        : { cancelled: true, path: null };
    }

    if (result.stderr.trim().length === 0) {
      return { cancelled: true, path: null };
    }

    throw new FolderDialogCommandError(commandFailureMessage(command, result));
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return "missing";
    }

    throw error;
  }
}

async function openLinuxFolderDialog(
  runCommand: DialogCommandRunner,
): Promise<FolderDialogResult> {
  const zenityResult = await tryOpenLinuxDialog(
    "zenity",
    ["--file-selection", "--directory", "--title", "Choose a git repository folder"],
    runCommand,
  );

  if (zenityResult !== "missing") {
    return zenityResult;
  }

  const kdialogResult = await tryOpenLinuxDialog(
    "kdialog",
    ["--getexistingdirectory", ".", "--title", "Choose a git repository folder"],
    runCommand,
  );

  if (kdialogResult !== "missing") {
    return kdialogResult;
  }

  throw new FolderDialogUnsupportedError(
    "Unable to open a folder picker on this Linux system. Install zenity or kdialog and try again.",
  );
}

export async function openFolderDialog({
  platform = os.platform(),
  runCommand = runDialogCommand,
}: {
  platform?: NodeJS.Platform;
  runCommand?: DialogCommandRunner;
} = {}): Promise<FolderDialogResult> {
  if (platform === "win32") {
    return openWindowsFolderDialog(runCommand);
  }

  if (platform === "darwin") {
    return openMacFolderDialog(runCommand);
  }

  if (platform === "linux") {
    return openLinuxFolderDialog(runCommand);
  }

  throw new FolderDialogUnsupportedError(
    `Folder picker is not supported on ${platform}.`,
  );
}
