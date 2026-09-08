import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Markdown from "./Markdown";

/** No DOM in this suite (`environment: node`), and none needed: rendering to
 * static markup is enough to assert what reaches the page. */
const render = (source: string) =>
  renderToStaticMarkup(<Markdown>{source}</Markdown>);

describe("Markdown", () => {
  it("renders the emphasis the model actually leans on", () => {
    const html = render("Run **#59** won by **$4,487.75**.");
    expect(html).toContain("<strong");
    expect(html).not.toContain("**");
  });

  it("renders lists, which is what a P&L answer is", () => {
    const html = render("- Throughput: +$8,084\n- Wages: −$720");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>");
    expect(html).toContain("Throughput");
  });

  it("renders GFM tables rather than leaving pipes on screen", () => {
    // Asked to compare two runs the model reaches for a table; without
    // remark-gfm this renders as literal pipe characters.
    const html = render("| Line | Δ |\n| --- | --- |\n| Wages | −$720 |");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("−$720");
  });

  it("flattens every heading level to one weight", () => {
    // The model's h2 and h4 are emphasis, not a document outline; six sizes
    // in a chat bubble would imply structure the reply does not have.
    const html = render("## Verdict\n\n#### Detail");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("<h4");
    expect(html).toContain("Verdict");
    expect(html).toContain("Detail");
  });

  it("keeps asterisks that are inside code, rather than reading them as bold", () => {
    const html = render("Use `a ** b` for the product.");
    expect(html).toContain("<code");
    expect(html).toContain("a ** b");
  });

  it("escapes raw HTML instead of rendering it", () => {
    // The security property, and the reason rehype-raw is deliberately
    // absent: model output is untrusted text as far as this component goes.
    const html = render("<img src=x onerror=alert(1)> and <b>bold</b>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img");
  });

  it("sends links away from the app without handing over the opener", () => {
    const html = render("[Trends](/?run=59&compare=58)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });

  it("renders a half-streamed reply without dropping its text", () => {
    // Tokens arrive one at a time, so the transcript spends most of a turn
    // holding markdown that is not closed yet.
    const html = render("Run #59 won by **$4,4");
    expect(html).toContain("Run #59 won by");
  });

  it("renders nothing for an empty reply", () => {
    expect(render("")).not.toContain("<p>");
  });
});
