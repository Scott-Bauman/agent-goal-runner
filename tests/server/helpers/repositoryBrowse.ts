import type { FastifyInstance } from "fastify";
import { vi } from "vitest";

import type { FolderDialogResult } from "../../../src/server/repository/folderDialog";

const folderDialogResults: FolderDialogResult[] = [];

export const openRepositoryFolderDialogMock = vi.fn(async () => {
  return folderDialogResults.shift() ?? { cancelled: true, path: null };
});

function queueRepositoryBrowsePath(repositoryPath: string): void {
  folderDialogResults.push({
    cancelled: false,
    path: repositoryPath,
  });
}

export function queueRepositoryBrowseResult(result: FolderDialogResult): void {
  folderDialogResults.push(result);
}

export async function browseRepository(
  app: FastifyInstance,
  repositoryPath: string,
) {
  queueRepositoryBrowsePath(repositoryPath);

  return app.inject({
    method: "POST",
    url: "/api/repository/browse",
  });
}

export function resetRepositoryBrowseMock(): void {
  folderDialogResults.splice(0);
  openRepositoryFolderDialogMock.mockClear();
}
