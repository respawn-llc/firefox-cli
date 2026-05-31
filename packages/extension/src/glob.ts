export type GlobQuestionMarkMode = "literal" | "wildcard";

export type GlobOptions = {
  readonly questionMark?: GlobQuestionMarkMode;
};

const REG_EXP_SPECIAL_CHARACTERS = new Set([
  "|",
  "\\",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  "^",
  "$",
  "+",
  ".",
  "?",
]);

export function compileGlob(glob: string, options: GlobOptions = {}): RegExp {
  const questionMarkMode = options.questionMark ?? "literal";
  const source = Array.from(glob)
    .map((character) => {
      if (character === "*") {
        return ".*";
      }
      if (character === "?" && questionMarkMode === "wildcard") {
        return ".";
      }
      return escapeRegExpCharacter(character);
    })
    .join("");
  return new RegExp(`^${source}$`, "u");
}

export function createGlobMatcher(glob: string, options: GlobOptions = {}): (value: string) => boolean {
  const expression = compileGlob(glob, options);
  return (value) => expression.test(value);
}

export function matchesGlob(value: string, glob: string, options: GlobOptions = {}): boolean {
  return compileGlob(glob, options).test(value);
}

function escapeRegExpCharacter(character: string): string {
  return REG_EXP_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character;
}
