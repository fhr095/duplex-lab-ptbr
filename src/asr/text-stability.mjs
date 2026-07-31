function words(text) {
  return String(text ?? "").trim().split(/\s+/u).filter(Boolean);
}

function comparable(word) {
  return word
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (
    index < limit &&
    comparable(left[index]) === comparable(right[index])
  ) {
    index += 1;
  }
  return index;
}

function startsWithWords(candidate, prefix) {
  return commonPrefixLength(candidate, prefix) === prefix.length;
}

export class TranscriptStabilizer {
  #committed = [];
  #previous = [];
  #holdbackWords;

  constructor(options = {}) {
    const holdbackWords = options.holdbackWords ?? 1;
    if (!Number.isInteger(holdbackWords) || holdbackWords < 0) {
      throw new RangeError("holdbackWords precisa ser inteiro não negativo");
    }
    this.#holdbackWords = holdbackWords;
  }

  get committedText() {
    return this.#committed.join(" ");
  }

  update(rawText) {
    const current = words(rawText);
    const agreement = commonPrefixLength(this.#previous, current);
    const safeAgreement = Math.max(0, agreement - this.#holdbackWords);
    const committedCompatible = startsWithWords(current, this.#committed);
    const nextCommittedCount = committedCompatible
      ? Math.max(this.#committed.length, safeAgreement)
      : this.#committed.length;

    if (committedCompatible && nextCommittedCount > this.#committed.length) {
      this.#committed = current.slice(0, nextCommittedCount);
    }

    const unstable = committedCompatible
      ? current.slice(this.#committed.length)
      : current;
    const result = {
      text: current.join(" "),
      committedText: this.#committed.join(" "),
      unstableText: unstable.join(" "),
      committedWords: this.#committed.length,
      totalWords: current.length,
      stability:
        current.length === 0
          ? 0
          : this.#committed.length / current.length,
      conflictsWithCommitted: !committedCompatible,
      changed: commonPrefixLength(this.#previous, current) !==
        Math.max(this.#previous.length, current.length)
    };

    this.#previous = current;
    return result;
  }

  finalize(rawText) {
    const finalWords = words(rawText);
    const previousText = this.#previous.join(" ");
    const committedCompatible = startsWithWords(finalWords, this.#committed);
    this.#previous = finalWords;
    this.#committed = finalWords;

    return {
      text: finalWords.join(" "),
      committedText: finalWords.join(" "),
      unstableText: "",
      committedWords: finalWords.length,
      totalWords: finalWords.length,
      stability: finalWords.length === 0 ? 0 : 1,
      conflictsWithCommitted: !committedCompatible,
      correctedAtFinal: previousText !== finalWords.join(" ")
    };
  }
}
