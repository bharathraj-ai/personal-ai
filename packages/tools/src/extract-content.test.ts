import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMainContent } from "./extract-content.js";

describe("extractMainContent", () => {
  it("keeps the article and drops navigation, menus, and cookie chrome", () => {
    const html = `
      <html><head><title>Sample Article</title>
      <meta name="author" content="Ada Lovelace" />
      </head><body>
        <nav>Home About Contact</nav>
        <div class="cookie-banner">Accept cookies</div>
        <article>
          <h1>Sample Article</h1>
          <p>Blondie is the protagonist of the film and the central character of the plot.</p>
        </article>
        <footer>Copyright 2020 · Privacy · Terms</footer>
      </body></html>
    `;
    const page = extractMainContent(html, "https://example.com/article");
    assert.match(page.content, /Blondie is the protagonist/);
    assert.equal(/Home About Contact/i.test(page.content), false);
    assert.equal(/Accept cookies/i.test(page.content), false);
    assert.equal(page.author, "Ada Lovelace");
    assert.equal(page.title, "Sample Article");
  });

  it("prefers Wikipedia main content over sidebar chrome", () => {
    const html = `
      <div id="mw-navigation">Main menu Languages Donate</div>
      <div id="mw-content-text" class="mw-parser-output">
        <p>The Good, the Bad and the Ugly is a 1966 Italian epic spaghetti Western.</p>
        <p>Clint Eastwood stars as Blondie, the film's protagonist.</p>
      </div>
    `;
    const page = extractMainContent(html, "https://en.wikipedia.org/wiki/The_Good,_the_Bad_and_the_Ugly");
    assert.match(page.content, /Clint Eastwood stars as Blondie/);
    assert.equal(/Main menu Languages Donate/i.test(page.content), false);
  });

  it("rejects browser-deprecated / JS-shell interstitials as unusable", () => {
    const html = `<html><title>Your browser is deprecated, please upgrade.</title>
      <body>Your browser is deprecated, please upgrade.</body></html>`;
    const page = extractMainContent(html, "https://music.youtube.com/channel/UCJcCB-QYPlBcbKcBQOTwhiA");
    assert.equal(page.unusable, true);
    assert.equal(page.content, "");
  });
});
