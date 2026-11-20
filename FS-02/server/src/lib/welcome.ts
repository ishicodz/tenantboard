import * as Y from "yjs";

type Block = { type: "heading"; level: number; text: string } | { type: "paragraph"; text: string } | { type: "bullet"; items: string[] };

/** Builds a Yjs doc in the shape TipTap's Collaboration extension expects ("default" XmlFragment + "title" Text). */
export function buildDoc(title: string, blocks: Block[] = []): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("title").insert(0, title);
  const frag = doc.getXmlFragment("default");
  const para = (text: string) => {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(text)]);
    return p;
  };
  const nodes = blocks.map((b) => {
    if (b.type === "heading") {
      const h = new Y.XmlElement("heading");
      h.setAttribute("level", b.level as unknown as string);
      h.insert(0, [new Y.XmlText(b.text)]);
      return h;
    }
    if (b.type === "bullet") {
      const ul = new Y.XmlElement("bulletList");
      ul.insert(
        0,
        b.items.map((t) => {
          const li = new Y.XmlElement("listItem");
          li.insert(0, [para(t)]);
          return li;
        }),
      );
      return ul;
    }
    return para(b.text);
  });
  frag.insert(0, nodes.length ? nodes : [para("")]);
  return Y.encodeStateAsUpdate(doc);
}

export const welcomeDoc = () =>
  buildDoc("Welcome", [
    { type: "heading", level: 1, text: "Welcome to your workspace" },
    { type: "paragraph", text: "Everything on this page syncs live. Open it in a second browser window and type in both." },
    {
      type: "bullet",
      items: [
        "Colored cursors show who is editing and where",
        "Select text and click Comment to start a thread",
        "History keeps snapshots you can preview and restore",
        "Share sets view, comment or edit access per person",
      ],
    },
  ]);
