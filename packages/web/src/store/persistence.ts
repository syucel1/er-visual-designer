import { get as idbGet, set as idbSet } from 'idb-keyval';
import { parseProject, serializeProject, type Project } from '@erd/model';
import { useStore } from './store';

const KEY = 'erd:autosave:v1';
const DEBOUNCE_MS = 500;

/** Loads the last autosaved project from IndexedDB (crash-safe recovery). */
export async function loadAutosave(): Promise<{ project: Project; warnings: string[] } | null> {
  try {
    const text = await idbGet<string>(KEY);
    if (!text) return null;
    return parseProject(text);
  } catch (e) {
    console.warn('Autosave could not be restored', e);
    return null;
  }
}

/** Saves the project to IndexedDB 500 ms after the last change. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = useStore.getState().project;
  const unsubscribe = useStore.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    clearTimeout(timer);
    useStore.getState().setSaveState('saving');
    timer = setTimeout(async () => {
      try {
        await idbSet(KEY, serializeProject(last));
        useStore.getState().setSaveState('saved');
      } catch (e) {
        console.error(e);
        useStore.getState().setSaveState('error');
      }
    }, DEBOUNCE_MS);
  });
  return () => { clearTimeout(timer); unsubscribe(); };
}
