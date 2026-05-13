declare module 'diff' {
  export function applyPatch(source: string, patch: string): string | false
  export function parsePatch(patch: string): any
}

declare module 'diff-match-patch' {
  export class diff_match_patch {
    patch_fromText(text: string): any
    patch_apply(patches: any, text: string): [string, boolean[]]
  }
}


