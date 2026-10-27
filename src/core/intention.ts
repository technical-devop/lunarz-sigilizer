export type CharacterClassification = 'kept' | 'vowel' | 'duplicate' | 'unsupported';

export type UnsupportedReason =
  | 'whitespace'
  | 'digit'
  | 'punctuation'
  | 'combining-mark'
  | 'control'
  | 'non-ascii';

export interface ClassifiedCharacter {
  readonly char: string;
  readonly index: number;
  readonly codePoint: number;
  readonly classification: CharacterClassification;
  readonly normalized: string | null;
  readonly duplicateOf: number | null;
  readonly unsupportedReason: UnsupportedReason | null;
}

export interface UnsupportedCharacter {
  readonly char: string;
  readonly index: number;
  readonly codePoint: number;
  readonly reason: UnsupportedReason;
}

export interface IntentionResult {
  readonly input: string;
  readonly characters: readonly ClassifiedCharacter[];
  readonly letters: readonly string[];
  readonly unsupported: readonly UnsupportedCharacter[];
  readonly isEmpty: boolean;
}

export const VOWELS: ReadonlySet<string> = new Set(['A', 'E', 'I', 'O', 'U']);

const ASCII_LETTER = /^[A-Za-z]$/;
const ASCII_DIGIT = /^[0-9]$/;
const WHITESPACE = /^\s$/u;
const COMBINING_MARK = /^\p{M}$/u;

function unsupportedReason(char: string, codePoint: number): UnsupportedReason {
  if (WHITESPACE.test(char)) {
    return 'whitespace';
  }

  if (COMBINING_MARK.test(char)) {
    return 'combining-mark';
  }

  if (ASCII_DIGIT.test(char)) {
    return 'digit';
  }

  if (codePoint < 32 || codePoint === 127) {
    return 'control';
  }

  const isPunctuation =
    (codePoint >= 33 && codePoint <= 47) ||
    (codePoint >= 58 && codePoint <= 64) ||
    (codePoint >= 91 && codePoint <= 96) ||
    (codePoint >= 123 && codePoint <= 126);

  if (isPunctuation) {
    return 'punctuation';
  }

  return 'non-ascii';
}

export function processIntention(input: string): IntentionResult {
  const characters: ClassifiedCharacter[] = [];
  const letters: string[] = [];
  const unsupported: UnsupportedCharacter[] = [];
  const firstOccurrence = new Map<string, number>();

  Array.from(input).forEach((char, index) => {
    const codePoint = char.codePointAt(0)!;

    if (ASCII_LETTER.test(char)) {
      const normalized = char.toUpperCase();

      if (VOWELS.has(normalized)) {
        characters.push({
          char,
          index,
          codePoint,
          classification: 'vowel',
          normalized,
          duplicateOf: null,
          unsupportedReason: null,
        });
        return;
      }

      const previousIndex = firstOccurrence.get(normalized);

      if (previousIndex !== undefined) {
        characters.push({
          char,
          index,
          codePoint,
          classification: 'duplicate',
          normalized,
          duplicateOf: previousIndex,
          unsupportedReason: null,
        });
        return;
      }

      firstOccurrence.set(normalized, index);
      letters.push(normalized);
      characters.push({
        char,
        index,
        codePoint,
        classification: 'kept',
        normalized,
        duplicateOf: null,
        unsupportedReason: null,
      });
      return;
    }

    const reason = unsupportedReason(char, codePoint);
    characters.push({
      char,
      index,
      codePoint,
      classification: 'unsupported',
      normalized: null,
      duplicateOf: null,
      unsupportedReason: reason,
    });
    unsupported.push({ char, index, codePoint, reason });
  });

  return {
    input,
    characters,
    letters,
    unsupported,
    isEmpty: letters.length === 0,
  };
}
