export type DataType = "str" | "int" | "float" | "bool" | "object" | "arr" | "js" | "enum";

export type ChainType = "or" | "and";

export interface Rule {
  type: string;
  value?: any;
  message?: string;
  [key: string]: any;
}

export interface SchemaProperty {
  id?: string; // Client-side only ID for React keys
  key: string;
  dataType: DataType;
  rules?: Rule[];
  required?: boolean;
  properties?: SchemaProperty[]; // For 'object' type
  items?: SchemaProperty; // For 'arr' type
  chain?: SchemaChain[]; // For complex nested logic
  js?: string; // For custom JS validation
}

export interface SchemaChain {
  chainType: ChainType;
  properties?: SchemaProperty[];
  // If a chain can have its own data type (unlikely, usually it's just a grouping of properties)
}

export interface ValidationSchema {
  dataType: DataType;
  properties?: SchemaProperty[];
  chain?: SchemaChain[];
  rules?: Rule[]; // Root level rules
  js?: string; // For root level custom JS validation
}

export interface SchemaEditorRef {
  save: () => void;
  getSchema: () => ValidationSchema;
}
