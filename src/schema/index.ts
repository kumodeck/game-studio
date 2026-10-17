// Typed entry to the one validator (studio-files.mjs) for the shell and the
// edit script. The server imports studio-files.mjs directly.
import type { LibraryFile, PlacementFile, ValidateResult } from '../contract.ts';
import { canonicalJSON, validateStudioFile } from './studio-files.mjs';

type Raw = { ok: true; value: object; json: string } | { ok: false; errors: string[] };

export function validatePlacement(json: unknown): ValidateResult<PlacementFile> {
  const r = validateStudioFile(json as object, { tool: 'placement' }) as Raw;
  return r.ok ? { ok: true, value: r.value as PlacementFile } : { ok: false, errors: r.errors };
}

export function validateLibrary(json: unknown): ValidateResult<LibraryFile> {
  const r = validateStudioFile(json as object, { tool: 'library' }) as Raw;
  return r.ok ? { ok: true, value: r.value as LibraryFile } : { ok: false, errors: r.errors };
}

export function stringifyResult(file: PlacementFile | LibraryFile): string {
  return canonicalJSON(file) as string;
}
