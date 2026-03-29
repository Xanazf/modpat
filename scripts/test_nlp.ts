import nlp from "compromise";

const plugin = {
  words: {
    equals: "Verb",
    plus: "Conjunction",
    minus: "Conjunction",
    then: "Conjunction",
    if: "Conjunction",
    all: "Conjunction",
    "|-": "Conjunction",
    not: "Adverb",
  },
};
nlp.plugin(plugin);
nlp.verbose(true);
// console.log(nlp.methods());

const text = "if humans then entities; if human then entity;";

const doc = nlp(text);
const json = doc.json();

const plurals = json[0].terms.filter((e: any) => {
  return e.tags.includes("Plural");
});

// console.log(JSON.stringify(json, null, 2));
console.log(JSON.stringify(plurals, null, 2));
