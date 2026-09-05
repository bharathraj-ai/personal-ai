import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeSearchIntent, generateSearchQueries } from "./search-intent.js";
import { hasRelationshipEvidence } from "./search-pipeline.js";
import { createEvidence } from "./verification/evidence.js";

import { extractLeadAnswer } from "./verification/policy.js";

describe("search intent", () => {
  it("understands hero of GBU as protagonist of The Good, the Bad and the Ugly", () => {
    const intent = analyzeSearchIntent("who is the hero of gbu");
    assert.equal(intent.relationship, "PROTAGONIST");
    assert.equal(intent.answerType, "PERSON/CHARACTER");
    assert.equal(intent.intent, "character identification");
    assert.ok(intent.entityCandidates.some((c) => /good.*bad.*ugly/i.test(c)));
    assert.ok(intent.generatedQueries.length >= 1);
    assert.equal(/who is the hero of gbu/i.test(intent.generatedQueries[0]!), false);
    assert.match(intent.generatedQueries[0]!, /protagonist|main character/i);
    assert.equal(intent.needsClarification, false);
  });

  it("maps director / capital / CEO / author / created / version queries", () => {
    assert.equal(analyzeSearchIntent("who directed Titanic").relationship, "DIRECTOR");
    assert.match(analyzeSearchIntent("who directed Titanic").generatedQueries[0]!, /Titanic director/i);

    assert.equal(analyzeSearchIntent("what is the capital of Japan").relationship, "CAPITAL");
    assert.match(analyzeSearchIntent("what is the capital of Japan").generatedQueries[0]!, /capital of Japan/i);

    assert.equal(analyzeSearchIntent("who is the current CEO of Apple").relationship, "CEO");
    assert.match(analyzeSearchIntent("who is the current CEO of Apple").generatedQueries[0]!, /Apple current CEO/i);

    assert.equal(analyzeSearchIntent("who wrote Harry Potter").relationship, "AUTHOR");
    assert.equal(analyzeSearchIntent("when was Python created").relationship, "CREATED");
    assert.equal(analyzeSearchIntent("what is the latest version of Node.js").relationship, "VERSION");
    assert.equal(analyzeSearchIntent("compare React and Next.js").relationship, "COMPARE");
    assert.equal(analyzeSearchIntent("what happened in the latest football match").relationship, "EVENT");
  });

  it("asks when the hero question has no entity", () => {
    const intent = analyzeSearchIntent("Who is the hero?");
    assert.equal(intent.needsClarification, true);
    assert.equal(intent.generatedQueries.length, 0);
  });

  it("does not treat a raw sentence as the only generated query when a relationship exists", () => {
    const qs = generateSearchQueries({
      original: "hero of Titanic",
      entity: "Titanic",
      candidates: ["Titanic"],
      relationship: "PROTAGONIST",
    });
    assert.match(qs[0]!, /Titanic protagonist main character/i);
  });
});

describe("relationship evidence", () => {
  it("requires protagonist evidence, not only a film definition", () => {
    const intent = analyzeSearchIntent("who is the hero of gbu");
    const definition = [
      createEvidence({
        type: "web",
        source: "wikipedia",
        title: "The Good, the Bad and the Ugly",
        url: "https://en.wikipedia.org/wiki/The_Good,_the_Bad_and_the_Ugly",
        content:
          "The Good, the Bad and the Ugly is a 1966 Italian epic spaghetti Western film directed by Sergio Leone.",
        metadata: { snippetOnly: false },
      }),
    ];
    assert.equal(hasRelationshipEvidence(definition, intent), false);

    const withHero = [
      createEvidence({
        type: "web",
        source: "wikipedia",
        title: "The Good, the Bad and the Ugly",
        url: "https://en.wikipedia.org/wiki/The_Good,_the_Bad_and_the_Ugly",
        content:
          "Clint Eastwood stars as Blondie, the film's protagonist, also known as the Man with No Name.",
        metadata: { snippetOnly: false },
      }),
    ];
    assert.equal(hasRelationshipEvidence(withHero, intent), true);
  });
});

describe("lead answer synthesis", () => {
  it("answers the protagonist, not a film definition", () => {
    const evidence = [
      createEvidence({
        type: "web",
        source: "wikipedia",
        title: "The Good, the Bad and the Ugly",
        url: "https://en.wikipedia.org/wiki/The_Good,_the_Bad_and_the_Ugly",
        content:
          "The Good, the Bad and the Ugly is a 1966 Italian epic spaghetti Western. Clint Eastwood stars as Blondie, the film's protagonist.",
        metadata: { snippetOnly: false },
      }),
    ];
    const lead = extractLeadAnswer("who is the hero of gbu", evidence);
    assert.ok(lead);
    assert.match(lead!, /Blondie|Clint Eastwood/);
    assert.equal(/\b1966 Italian epic\b/i.test(lead!), false);
  });

  it("does not use a YouTube browser-deprecated interstitial as the answer for a person lookup", () => {
    const intent = analyzeSearchIntent("vj siddhu");
    assert.equal(intent.answerType, "PERSON/CHARACTER");
    assert.match(intent.generatedQueries[0]!, /biography|who is vj siddhu/i);
    assert.ok(intent.generatedQueries.some((q) => /biography|who is/i.test(q)));

    const evidence = [
      createEvidence({
        type: "web",
        source: "music.youtube.com",
        title: "Your browser is deprecated, please upgrade.",
        url: "https://music.youtube.com/channel/UCJcCB-QYPlBcbKcBQOTwhiA",
        content: "Your browser is deprecated, please upgrade.",
        metadata: { snippetOnly: false },
      }),
      createEvidence({
        type: "web",
        source: "leaderbiography.com",
        title: "VJ Siddhu Biography, Age, Height, Education, Wife, Career, Net Worth",
        url: "https://leaderbiography.com/vj-siddhu/",
        content:
          "VJ Siddhu is an Indian television presenter and YouTuber known for hosting comedy and talk shows.",
        metadata: { snippetOnly: false },
      }),
    ];
    const lead = extractLeadAnswer("vj siddhu", evidence);
    assert.ok(lead);
    assert.match(lead!, /VJ Siddhu is an Indian/i);
    assert.equal(/browser is deprecated/i.test(lead!), false);
  });
});
