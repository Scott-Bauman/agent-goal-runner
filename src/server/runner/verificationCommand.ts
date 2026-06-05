import path from "node:path";

export type ParsedVerificationCommand = {
  executable: string;
  args: string[];
};

export type VerificationCommandParseResult =
  | {
      success: true;
      parsed: ParsedVerificationCommand | null;
    }
  | {
      success: false;
      error: string;
    };

const SHELL_OPERATOR_CHARACTERS = new Set(["|", "&", ";", "<", ">", "`"]);
const SHELL_EXECUTABLES = new Set([
  "bash",
  "bash.exe",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "sh.exe",
]);

export function parseVerificationCommand(
  command: string,
): VerificationCommandParseResult {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    return {
      success: true,
      parsed: null,
    };
  }

  const tokens: string[] = [];
  let currentToken = "";
  let tokenStarted = false;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  function appendCurrentToken(): void {
    if (tokenStarted) {
      tokens.push(currentToken);
      currentToken = "";
      tokenStarted = false;
    }
  }

  for (const character of trimmedCommand) {
    if (escaped) {
      tokenStarted = true;
      currentToken += character;
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = null;
        continue;
      }

      currentToken += character;
      continue;
    }

    if (character === "\"" || character === "'") {
      tokenStarted = true;
      quote = character;
      continue;
    }

    if (/\s/u.test(character)) {
      appendCurrentToken();
      continue;
    }

    if (SHELL_OPERATOR_CHARACTERS.has(character)) {
      return {
        success: false,
        error:
          "Verification command must use a single executable plus arguments; shell operators are not supported.",
      };
    }

    tokenStarted = true;
    currentToken += character;
  }

  if (escaped) {
    tokenStarted = true;
    currentToken += "\\";
  }

  if (quote) {
    return {
      success: false,
      error: "Verification command contains an unterminated quoted argument.",
    };
  }

  appendCurrentToken();

  if (tokens.length === 0) {
    return {
      success: false,
      error: "Verification command must include an executable.",
    };
  }

  const [executable, ...args] = tokens;
  const executableName = path.basename(executable).toLowerCase();

  if (SHELL_EXECUTABLES.has(executableName)) {
    return {
      success: false,
      error: "Verification command must be a direct executable, not a shell.",
    };
  }

  return {
    success: true,
    parsed: {
      executable,
      args,
    },
  };
}
