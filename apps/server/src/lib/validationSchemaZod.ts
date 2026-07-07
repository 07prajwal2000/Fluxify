import { z } from 'zod';

export const DataTypeZod = z.enum([
  'str', 'int', 'float', 'bool', 'object', 'arr', 'js', 'enum'
]);

export const ChainTypeZod = z.enum(['or', 'and']);

export const RuleZod = z.object({
  type: z.string(),
  value: z.any().optional(),
  message: z.string().optional(),
}).catchall(z.any());

// Need base schema to define recursive types
const baseSchemaProperty = z.object({
  id: z.string().optional(),
  key: z.string(),
  dataType: DataTypeZod,
  rules: z.array(RuleZod).optional(),
  required: z.boolean().optional(),
  js: z.string().optional(),
});

type SchemaPropertyType = z.infer<typeof baseSchemaProperty> & {
  properties?: SchemaPropertyType[];
  items?: SchemaPropertyType;
  chain?: {
    chainType: z.infer<typeof ChainTypeZod>;
    properties?: SchemaPropertyType[];
  }[];
};

export const SchemaPropertyZod: z.ZodType<SchemaPropertyType> = baseSchemaProperty.extend({
  properties: z.lazy(() => z.array(SchemaPropertyZod)).optional(),
  items: z.lazy(() => SchemaPropertyZod).optional(),
  chain: z.lazy(() => z.array(SchemaChainZod)).optional(),
});

export const SchemaChainZod = z.object({
  chainType: ChainTypeZod,
  properties: z.array(SchemaPropertyZod).optional(),
});

export const ValidationSchemaZod = z.object({
  dataType: DataTypeZod,
  properties: z.array(SchemaPropertyZod).optional(),
  items: z.lazy(() => SchemaPropertyZod).optional(),
  chain: z.array(SchemaChainZod).optional(),
  rules: z.array(RuleZod).optional(),
  js: z.string().optional(),
});
