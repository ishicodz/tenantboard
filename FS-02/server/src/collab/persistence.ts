import * as Y from "yjs";
import { prisma } from "../db/client.js";
import { config } from "../config.js";

export async function loadDocState(pageId: string): Promise<Uint8Array | null> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { ydoc: true } });
  return page?.ydoc ? new Uint8Array(page.ydoc) : null;
}

/**
 * Writes the document to Postgres. The stored state is merged with ours
 * rather than overwritten, so two instances flushing at the same time can
 * never drop each other's edits (CRDT merges are commutative and idempotent).
 */
export async function saveDocState(pageId: string, doc: Y.Doc) {
  const stored = await loadDocState(pageId);
  const mine = Y.encodeStateAsUpdate(doc);
  const merged = stored ? Y.mergeUpdates([stored, mine]) : mine;
  const title = doc.getText("title").toString().trim().slice(0, 200) || "Untitled";
  await prisma.page.updateMany({ where: { id: pageId }, data: { ydoc: Buffer.from(merged), title } });
  await maybeAutoSnapshot(pageId, merged);
}

async function maybeAutoSnapshot(pageId: string, state: Uint8Array) {
  const last = await prisma.snapshot.findFirst({ where: { pageId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && Date.now() - last.createdAt.getTime() < config.autoSnapshotIntervalMs) return;
  await prisma.snapshot.create({
    data: { pageId, label: "Auto-save", state: Buffer.from(state), auto: true },
  });
}

/** Plain-text extraction of the ProseMirror fragment, for search and tests. */
export function docToText(doc: Y.Doc): string {
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment): string => {
    if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]+>/g, "");
    const inner = node.toArray().map((c) => walk(c as Y.XmlElement)).join("");
    return node instanceof Y.XmlElement && ["paragraph", "heading", "codeBlock"].includes(node.nodeName)
      ? inner + "\n"
      : inner;
  };
  return walk(doc.getXmlFragment("default")).trim();
}
