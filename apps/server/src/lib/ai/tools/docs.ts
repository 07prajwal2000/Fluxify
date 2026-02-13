import { tool } from "langchain";
import z from "zod";
import { docsSearch } from "../../docs";

export const searchDocsTool = tool(
  async ({ query }: { query: string }) => {
    console.log("Searching for:", query);
    const results = docsSearch.search(query).map((doc) => ({
      id: doc.id,
      title: doc.title,
      description: doc.description,
    }));
    // Return stringified JSON for the LLM to read
    return JSON.stringify(results);
  },
  {
    name: "search_docs",
    description:
      "Search the documentation library for relevant pages. Returns a list of page titles and IDs.",
    schema: z.object({
      query: z.string().describe("The search query, e.g., 'javascript logic'"),
    }),
  },
);

export const readDocsContentTool = tool(
  async ({ id }: { id: number }) => {
    console.log("Reading content for:", id);
    const content = docsSearch.getById(id)?.content;
    return content || "ERROR: Document content not found.";
  },
  {
    name: "read_document_content",
    description:
      "Retrieve the full markdown content of a specific documentation page by its ID.",
    schema: z.object({
      id: z
        .number()
        .describe("The ID of the document retrieved from search_docs"),
    }),
  },
);
