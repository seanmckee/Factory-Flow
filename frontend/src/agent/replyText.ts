/**
 * One reply bubble collects the text of several model messages: the model
 * writes, calls tools, then writes again. Their tokens arrive on one stream
 * with nothing between them, so "…an available operator." and "Cutter is
 * indeed…" would run together as "operator.Cutter". Text that resumes after a
 * tool call starts a new paragraph instead.
 */
export function appendReplyText(
  text: string,
  token: string,
  toolCallSinceText: boolean,
): string {
  if (text === "" || !toolCallSinceText) return text + token;
  return `${text.trimEnd()}\n\n${token.trimStart()}`;
}
