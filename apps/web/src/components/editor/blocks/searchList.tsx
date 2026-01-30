import { IoLogoJavascript } from "react-icons/io";
import {
  TbCookie,
  TbDatabase,
  TbDatabaseEdit,
  TbDatabaseImport,
  TbDatabasePlus,
  TbDatabaseSearch,
  TbDatabaseX,
  TbDoorExit,
  TbInfinity,
  TbNote,
  TbTerminal2,
  TbWorldCode,
} from "react-icons/tb";
import { FaHeading, FaMapSigns, FaToolbox, FaCode } from "react-icons/fa";
import {
  TbCodeVariablePlus,
  TbCodeVariable,
  TbTransform,
  TbMatrix,
} from "react-icons/tb";
import { VscSymbolParameter, VscSymbolMisc } from "react-icons/vsc";
import { MdDataObject, MdHttp, MdOutlineReportGmailerrorred } from "react-icons/md";
import { BlockCategory, BlockTypes } from "@/types/block";
import { LuDatabaseZap } from "react-icons/lu";

const iconStyles: React.CSSProperties = {};

const iconSize = 20;

export const categoryList = [
  {
    id: crypto.randomUUID(),
    category: BlockCategory.Core,
    description: "Core blocks that are used for basic operations.",
    icon: <FaToolbox style={iconStyles} size={iconSize} />,
  },
  {
    id: crypto.randomUUID(),
    category: BlockCategory.Flow,
    description: "Flow blocks that are used for control flow.",
    icon: <FaMapSigns style={iconStyles} size={iconSize} />,
  },
  {
    id: crypto.randomUUID(),
    category: BlockCategory.Database,
    description: "Database blocks that are used for database operations.",
    icon: <TbDatabase style={iconStyles} size={iconSize} />,
  },
  {
    id: crypto.randomUUID(),
    category: BlockCategory.HTTP,
    description: "HTTP blocks that are used for HTTP operations.",
    icon: <MdHttp style={iconStyles} size={iconSize} />,
  },
  {
    id: crypto.randomUUID(),
    category: BlockCategory.Logging,
    description: "Logging blocks that are used for logging.",
    icon: <TbTerminal2 style={iconStyles} size={iconSize} />,
  },
  {
    id: crypto.randomUUID(),
    category: BlockCategory.Misc,
    description: "Misc blocks that are used for misc operations.",
    icon: <VscSymbolMisc style={iconStyles} size={iconSize} />,
  },
];

const blocksForSearch = [
  {
    id: crypto.randomUUID(),
    title: "Response",
    description: "A block that returns a response to the user.",
    icon: <TbDoorExit style={iconStyles} size={iconSize} />,
    tags: ["response", "output"],
    type: BlockTypes.response,
    category: BlockCategory.Core,
  },
  {
    id: crypto.randomUUID(),
    title: "If",
    description:
      "An if block that can be used to conditionally execute a block.",
    icon: <FaMapSigns style={iconStyles} size={iconSize} />,
    tags: ["condition", "control flow"],
    type: BlockTypes.if,
    category: BlockCategory.Flow,
  },
  {
    id: crypto.randomUUID(),
    title: "JS Runner",
    description: "A block that can be used to execute a JavaScript code.",
    icon: <IoLogoJavascript size={iconSize} />,
    tags: ["javascript", "runner"],
    type: BlockTypes.jsrunner,
    category: BlockCategory.Misc,
  },
  {
    id: crypto.randomUUID(),
    title: "Set Var",
    description: "A block that can be used to set a variable.",
    icon: <TbCodeVariablePlus size={iconSize} />,
    tags: ["variable", "set"],
    type: BlockTypes.setvar,
    category: BlockCategory.Core,
  },
  {
    id: crypto.randomUUID(),
    title: "Get Var",
    description: "A block that can be used to get a variable.",
    icon: <TbCodeVariable size={iconSize} />,
    tags: ["variable", "get"],
    type: BlockTypes.getvar,
    category: BlockCategory.Core,
  },
  {
    id: crypto.randomUUID(),
    title: "Transformer",
    description: "A block that can be used to transform data.",
    icon: <TbTransform size={iconSize} />,
    tags: ["transformer", "data"],
    type: BlockTypes.transformer,
    category: BlockCategory.Core,
  },
  {
    id: crypto.randomUUID(),
    title: "Array Operations",
    description: "A block that can be used to perform array operations.",
    icon: <TbMatrix size={iconSize} />,
    tags: ["array", "operations"],
    type: BlockTypes.arrayops,
    category: BlockCategory.Core,
  },
  {
    id: crypto.randomUUID(),
    title: "HTTP Request",
    description: "Performs an HTTP request to an external API.",
    icon: <MdHttp size={iconSize} />,
    tags: ["http", "request"],
    type: BlockTypes.httprequest,
    category: BlockCategory.HTTP,
  },
  {
    id: crypto.randomUUID(),
    title: "Console Log",
    description:
      "Logs a message to internal console and displayed in execution history.",
    icon: <TbTerminal2 size={iconSize} />,
    tags: ["console", "log"],
    type: BlockTypes.consolelog,
    category: BlockCategory.Logging,
  },
  {
    id: crypto.randomUUID(),
    title: "For Loop",
    description:
      "Regular for loop block that starts and stops based on given parameters.",
    icon: <TbInfinity size={iconSize} />,
    tags: ["loop", "for"],
    type: BlockTypes.forloop,
    category: BlockCategory.Flow,
  },
  {
    id: crypto.randomUUID(),
    title: "Foreach Loop",
    description: "Foreach loop block that iterates over an array of items.",
    icon: <TbInfinity size={iconSize} />,
    tags: ["loop", "foreach"],
    type: BlockTypes.foreachloop,
    category: BlockCategory.Flow,
  },
  {
    id: crypto.randomUUID(),
    title: "Get Request Cookie",
    description: "Get a cookie from the request headers.",
    icon: <TbCookie size={iconSize} />,
    tags: ["cookie", "get"],
    type: BlockTypes.httpgetcookie,
    category: BlockCategory.HTTP,
  },
  {
    id: crypto.randomUUID(),
    title: "Set Response Cookie",
    description: "Set cookie for the response.",
    icon: <TbCookie size={iconSize} />,
    tags: ["cookie", "set"],
    type: BlockTypes.httpsetcookie,
    category: BlockCategory.HTTP,
  },
  {
    id: crypto.randomUUID(),
    title: "Get Request Header",
    description: "Get header by name from the request headers.",
    icon: <FaHeading size={iconSize} />,
    tags: ["header", "get"],
    type: BlockTypes.httpgetheader,
    category: BlockCategory.HTTP,
  },
  {
    id: crypto.randomUUID(),
    title: "Set Request Header",
    description: "Set a header for the request.",
    icon: <FaHeading size={iconSize} />,
    tags: ["header", "set"],
    type: BlockTypes.httpsetheader,
    category: BlockCategory.HTTP,
  },
  {
    id: crypto.randomUUID(),
    title: "Get Request Param",
    description: "Get a parameter (query/route) from the request URL.",
    icon: <VscSymbolParameter size={iconSize} />,
    tags: ["param", "get"],
    type: BlockTypes.httpgetparam,
    category: BlockCategory.HTTP,
  },
  {
    id: crypto.randomUUID(),
    title: "Get Request Body",
    description: "Get the body of the request (JSON/Text/FormData).",
    icon: <MdDataObject size={iconSize} />,
    tags: ["body", "get", "request"],
    type: BlockTypes.httpgetrequestbody,
    category: BlockCategory.HTTP,
  },
  {
    id: crypto.randomUUID(),
    title: "Get Single Record from Database",
    description: "Get a single record from the database using conditions.",
    icon: <TbDatabaseSearch size={iconSize} />,
    tags: ["database", "get", "db"],
    type: BlockTypes.db_getsingle,
    category: BlockCategory.Database,
  },
  {
    id: crypto.randomUUID(),
    title: "Get Multiple Records from Database",
    description:
      "Get multiple records from the database using conditions. (Hard limit: 1000)",
    icon: <TbDatabaseSearch size={iconSize} />,
    tags: ["database", "get", "db"],
    type: BlockTypes.db_getall,
    category: BlockCategory.Database,
  },
  {
    id: crypto.randomUUID(),
    title: "Insert Record to Database",
    description: "Insert a single record to the database.",
    icon: <TbDatabasePlus size={iconSize} />,
    tags: ["database", "insert", "db"],
    type: BlockTypes.db_insert,
    category: BlockCategory.Database,
  },
  {
    id: crypto.randomUUID(),
    title: "Bulk Insert to Database",
    description: "Insert multiple records to the database.",
    icon: <TbDatabasePlus size={iconSize} />,
    tags: ["database", "insert", "db", "bulk"],
    type: BlockTypes.db_insertbulk,
    category: BlockCategory.Database,
  },
  {
    id: crypto.randomUUID(),
    title: "Update Record(s) in Database",
    description: "Update one or more records in the database using conditions.",
    icon: <TbDatabaseImport size={iconSize} />,
    tags: ["database", "update", "db"],
    type: BlockTypes.db_update,
    category: BlockCategory.Database,
  },
  {
    id: crypto.randomUUID(),
    title: "Delete Record(s) in Database",
    description:
      "Delete one or more records from the database using conditions.",
    icon: <TbDatabaseX size={iconSize} />,
    tags: ["database", "delete", "db"],
    type: BlockTypes.db_delete,
    category: BlockCategory.Database,
  },
  {
    id: crypto.randomUUID(),
    title: "Start Transaction",
    description:
      "Start a database transaction to perform multiple database operations atomically.",
    icon: <LuDatabaseZap size={iconSize} />,
    tags: ["database", "transaction", "db", "acid", "atomicity"],
    type: BlockTypes.db_transaction,
    category: BlockCategory.Database,
  },
  {
    id: crypto.randomUUID(),
    title: "Native Database Object",
    description:
      "Get a native database connection object to perform custom database operations using javascript.",
    icon: <TbDatabaseEdit size={iconSize} />,
    tags: ["database", "native", "orm", "db", "raw", "sql"],
    type: BlockTypes.db_native,
    category: BlockCategory.Database,
  },
].sort((a, b) => (a.title > b.title ? 1 : -1));

export const blockIcons: Record<string, React.ReactNode> = {};
blockIcons[BlockTypes.entrypoint] = <TbWorldCode size={iconSize} />;
blockIcons[BlockTypes.stickynote] = <TbNote size={iconSize} />;
blockIcons[BlockTypes.errorHandler] = <MdOutlineReportGmailerrorred size={iconSize} />;
blocksForSearch.forEach((block) => {
  blockIcons[block.type] = block.icon;
});

export default blocksForSearch;
