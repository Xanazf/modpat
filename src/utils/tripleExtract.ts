import nlp from "compromise";

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * Extracts Subject-Verb-Object triples from a sentence using compromise NLP.
 * Uses nouns() and verbs() from the base compromise package (no plugins needed).
 * Returns an empty array for sentences where no SVO structure is found.
 */
export function extractTriples(text: string): Triple[] {
  const out: Triple[] = [];
  const doc = nlp(text);

  const nouns = doc.nouns().out("array") as string[];
  const verb = doc.verbs().toInfinitive().out("text").trim();

  if (nouns.length >= 2 && verb) {
    // First noun = subject, last noun (distinct) = object
    const subject = nouns[0].trim().toLowerCase();
    const object = nouns[nouns.length - 1].trim().toLowerCase();
    if (subject && object && subject !== object) {
      out.push({ subject, predicate: verb.toLowerCase(), object });
    }
  } else if (nouns.length === 1 && verb) {
    // Single noun with copula — treat as "X is Y" from the adjective
    const adj = doc.adjectives().out("text").trim();
    if (adj) {
      out.push({
        subject: nouns[0].trim().toLowerCase(),
        predicate: verb.toLowerCase(),
        object: adj.toLowerCase(),
      });
    }
  }

  return out;
}
