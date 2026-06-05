export type GoalFileResponse = {
  exists?: boolean;
  goalPath: string;
  markdown: string;
  repositoryPath: string;
};

export type GoalFileState =
  | {
      status: "idle" | "loading" | "available" | "missing" | "creating";
      error: null;
      goalPath: string | null;
      markdown: string | null;
      repositoryPath: string | null;
    }
  | {
      status: "error";
      error: string;
      goalPath: null;
      markdown: null;
      repositoryPath: null;
    };
