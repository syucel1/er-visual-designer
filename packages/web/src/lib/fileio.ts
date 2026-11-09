import { FILE_EXTENSION, parseProject, serializeProject, ProjectFormatError, type Project } from '@erd/model';

/** Downloads the project as `<name>.erd.json`. */
export function saveProjectFile(project: Project) {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${project.name || 'schema'}${FILE_EXTENSION}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Opens a file picker and parses the chosen `.erd.json`. Resolves null if the user cancels. */
export function openProjectFile(): Promise<{ project: Project; warnings: string[]; fileName: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const { project, warnings } = parseProject(await file.text());
        resolve({ project, warnings, fileName: file.name });
      } catch (e) {
        reject(e instanceof ProjectFormatError ? e : new ProjectFormatError((e as Error).message));
      }
    };
    input.click();
  });
}
