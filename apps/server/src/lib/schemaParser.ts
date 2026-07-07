import { z } from 'zod';
import { ValidationSchemaZod } from './validationSchemaZod';
import { JsVM } from '@fluxify/lib';

export class ValidationError extends Error {
  payload: any;
  constructor(payload: any) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.payload = payload;
  }
}

type ParserContext = {
  vm: JsVM;
  coerce?: boolean;
};

// Map primitive types to base Zod schemas
function getBaseZodType(dataType: string, coerce = false): z.ZodTypeAny {
  switch (dataType) {
    case 'str': return coerce ? z.coerce.string() : z.string();
    case 'int': return (coerce ? z.coerce.number() : z.number()).int();
    case 'float': return coerce ? z.coerce.number() : z.number();
    case 'bool': return coerce ? z.coerce.boolean() : z.boolean();
    case 'object': return z.object({});
    case 'arr': return z.array(z.any());
    default: return z.any();
  }
}

// Apply validation rules to a Zod schema
function applyRules(schema: z.ZodTypeAny, dataType: string, rules: any[] = []): z.ZodTypeAny {
  let s = schema as any;
  for (const rule of rules) {
    if (dataType === 'str') {
      if (rule.type === 'minLength' && rule.value != null) s = s.min(Number(rule.value));
      if (rule.type === 'maxLength' && rule.value != null) s = s.max(Number(rule.value));
      if (rule.type === 'regex' && rule.value) s = s.regex(new RegExp(rule.value));
      if (rule.type === 'startsWith' && rule.value) s = s.startsWith(rule.value);
      if (rule.type === 'endsWith' && rule.value) s = s.endsWith(rule.value);
      if (rule.type === 'contains' && rule.value) s = s.includes(rule.value);
      if (rule.type === 'notContains' && rule.value) {
         s = s.refine((val: string) => !val.includes(rule.value), { message: `Must not contain ${rule.value}` });
      }
    }
    
    if (dataType === 'int' || dataType === 'float') {
      if (rule.type === 'min' && rule.value != null) s = s.min(Number(rule.value));
      if (rule.type === 'max' && rule.value != null) s = s.max(Number(rule.value));
    }
    
    if (dataType === 'arr') {
      if (rule.type === 'minItems' && rule.value != null) s = s.min(Number(rule.value));
      if (rule.type === 'maxItems' && rule.value != null) s = s.max(Number(rule.value));
    }
  }
  return s;
}

export function buildZodSchema(schemaDef: any, context: ParserContext): z.ZodTypeAny {
  const { dataType, properties, items, rules, js, required } = schemaDef;

  let zSchema: z.ZodTypeAny;

  if (dataType === 'js') {
    zSchema = z.any().superRefine(async (val, ctx) => {
      if (!js) return;
      try {
        const result = await context.vm.runAsync(js, val);
        if (!result) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Custom JS validation failed' });
        }
      } catch (err: any) {
        if (err?.name === 'ValidationError' || err?.constructor?.name === 'ValidationError') {
          const payload = err.payload || err;
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: JSON.stringify(payload) });
        } else {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: err?.message || 'Error executing JS validation' });
        }
      }
    });
  } else if (dataType === 'enum') {
    const enumRule = rules?.find((r: any) => r.type === 'values');
    const vals = enumRule?.value && Array.isArray(enumRule.value) ? enumRule.value : [];
    if (vals.length > 0) {
      if (vals.every((v: any) => typeof v === 'string')) {
        zSchema = z.enum(vals as [string, ...string[]]);
      } else {
        zSchema = z.union(vals.map((v: any) => z.literal(v)) as any);
      }
    } else {
      zSchema = z.any(); // fallback if no enum values defined
    }
  } else {
    zSchema = getBaseZodType(dataType, context.coerce);

    if (dataType === 'object' && properties) {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const prop of properties) {
        shape[prop.key] = buildZodSchema(prop, context);
      }
      zSchema = z.object(shape);
    } else if (dataType === 'arr' && items) {
      zSchema = z.array(buildZodSchema(items, context));
    }
    
    zSchema = applyRules(zSchema, dataType, rules);
  }

  if (required === false) {
    zSchema = zSchema.optional();
  }

  return zSchema;
}

export const parseRequestSchema = async (schemaJson: any, requestData: any, context: ParserContext) => {
  // Validate schema JSON itself against DB Zod schema
  const parsedDef = ValidationSchemaZod.safeParse(schemaJson);
  if (!parsedDef.success) {
    return { 
      success: false, 
      errors: [{ path: 'schema', property: 'schema', errors: ['Invalid schema definition format'] }] 
    };
  }

  const executableSchema = buildZodSchema(parsedDef.data, context);
  const result = await executableSchema.safeParseAsync(requestData);

  if (result.success) {
    return { success: true };
  } else {
    const formattedErrors = result.error.issues.map(issue => {
      let customErrorObj = null;
      try { 
        customErrorObj = JSON.parse(issue.message); 
      } catch (e) {
        // Not a JSON string (standard zod error message)
      }

      return {
        path: issue.path.join('.'),
        property: issue.path[issue.path.length - 1]?.toString() || '',
        errors: customErrorObj ? [customErrorObj] : [issue.message]
      };
    });
    
    return { success: false, errors: formattedErrors };
  }
};
