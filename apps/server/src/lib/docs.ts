import { Document } from "flexsearch";
import matter from "gray-matter";
import {
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";

interface MarkdownDoc {
  id: number;
  title: string;
  description: string;
  content: string;
  [key: string]: any;
}

export let docsSearch: DocSearch;

export async function initDocsSearch() {
  docsSearch = new DocSearch();
  if (process.env.NODE_ENV !== "production") {
    await docsSearch.build("./docs", "./docs_index");
  }
  await docsSearch.load("./docs_index");
}

export class DocSearch {
  private index: Document<MarkdownDoc>;

  constructor() {
    this.index = new Document<MarkdownDoc>({
      document: {
        id: "id",
        index: ["title", "description", "content"],
        store: ["id", "title", "description", "content"],
      },
      tokenize: "forward",
    });
  }

  private *getMarkdownFiles(dir: string): Generator<string> {
    const list = readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = statSync(filePath);
      if (stat.isDirectory()) yield* this.getMarkdownFiles(filePath);
      else if (file.endsWith(".md")) yield filePath;
    }
  }

  /**
   * GET BY ID: Retrieves the full stored document by its unique ID.
   */
  getById(id: number): MarkdownDoc | null {
    // index.get() returns the stored document object
    return (this.index.get(id) as MarkdownDoc) || null;
  }

  async build(
    docsFolder: string,
    destinationIndexFolder: string,
  ): Promise<void> {
    if (existsSync(destinationIndexFolder)) {
      rmSync(destinationIndexFolder, { recursive: true, force: true });
    }
    mkdirSync(destinationIndexFolder, { recursive: true });

    let idCounter = 0;
    const absoluteDocsPath = path.resolve(docsFolder);
    console.log(`🔨 Starting fresh docs build from: ${absoluteDocsPath}`);

    for (const filePath of this.getMarkdownFiles(absoluteDocsPath)) {
      try {
        const rawFile = await Bun.file(filePath).text();
        const { data, content } = matter(rawFile);

        this.index.add({
          id: ++idCounter,
          title: data.title || path.basename(filePath),
          description: data.description || "",
          content: content.trim(),
        });
      } catch (e) {
        console.error(`| ❌ Error at ${filePath}:`, e);
      }
    }

    return new Promise((resolve) => {
      let timer: Timer;
      this.index.export((key, data) => {
        writeFileSync(
          path.join(destinationIndexFolder, `${key}.json`),
          (data as string) || "",
        );
        clearTimeout(timer);
        timer = setTimeout(() => {
          console.log(`✅ Build Complete. ${idCounter} docs indexed.`);
          resolve();
        }, 500);
      });
    });
  }

  async load(indexFolder: string): Promise<void> {
    const absPath = path.resolve(indexFolder);
    if (!existsSync(absPath))
      throw new Error(`Index folder missing: ${absPath}`);
    const files = readdirSync(absPath).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const key = path.basename(file, ".json");
      const data = readFileSync(path.join(absPath, file), "utf8");
      await this.index.import(key, data);
    }
    console.log(`🚀 Loaded ${files.length} shards.`);
  }

  search(query: string, limit = 5) {
    const results = this.index.search(query, { enrich: true, limit });
    if (!results.length) return [];

    const flat = results.flatMap((field) =>
      field.result.map((item) => ({
        id: item.doc!.id as number,
        title: item.doc!.title as string,
        description: item.doc!.description as string,
        content: item.doc!.content as string,
      })),
    );

    // Filter duplicates (matches in multiple fields)
    return Array.from(new Map(flat.map((r) => [r.id, r])).values());
  }
}
