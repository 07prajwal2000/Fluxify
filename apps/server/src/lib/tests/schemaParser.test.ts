import { test, expect, describe } from 'bun:test';
import { parseRequestSchema } from '../schemaParser';
import { JsVM } from '@fluxify/lib';

describe('schemaParser Exhaustive Test Suite', () => {
  const context = { vm: new JsVM({}) };

  describe('Primitive Types and Boundary Rules', () => {
    test('String validations (length, regex, startsWith, endsWith, contains, notContains)', async () => {
      const schema = {
        dataType: 'str',
        rules: [
          { type: 'minLength', value: 3 },
          { type: 'maxLength', value: 50 },
          { type: 'regex', value: '^[a-zA-Z\\s]+$' },
          { type: 'startsWith', value: 'hello' },
          { type: 'endsWith', value: 'world' },
          { type: 'contains', value: 'beautiful' },
          { type: 'notContains', value: 'ugly' }
        ]
      };

      expect((await parseRequestSchema(schema, 'hello beautiful world', context)).success).toBe(true);
      expect((await parseRequestSchema(schema, 'hello world', context)).success).toBe(false); // missing 'beautiful'
      expect((await parseRequestSchema(schema, 'hello beautiful ugly world', context)).success).toBe(false); // contains 'ugly'
      expect((await parseRequestSchema(schema, 'hi beautiful world', context)).success).toBe(false); // bad startsWith
      expect((await parseRequestSchema(schema, 'hello beautiful planet', context)).success).toBe(false); // bad endsWith
      expect((await parseRequestSchema(schema, 'he', context)).success).toBe(false); // minLength
      expect((await parseRequestSchema(schema, 'hello beautiful world forever', context)).success).toBe(false); // maxLength
      expect((await parseRequestSchema(schema, 'hello b3autiful world', context)).success).toBe(false); // regex failure
    });

    test('Integer and Float validations (min, max)', async () => {
      const schemaInt = {
        dataType: 'int',
        rules: [ { type: 'min', value: -10 }, { type: 'max', value: 100 } ]
      };

      expect((await parseRequestSchema(schemaInt, 50, context)).success).toBe(true);
      expect((await parseRequestSchema(schemaInt, -10, context)).success).toBe(true);
      expect((await parseRequestSchema(schemaInt, -11, context)).success).toBe(false);
      expect((await parseRequestSchema(schemaInt, 101, context)).success).toBe(false);
      expect((await parseRequestSchema(schemaInt, 50.5, context)).success).toBe(false); // float fails int schema

      const schemaFloat = {
        dataType: 'float',
        rules: [ { type: 'min', value: 0 }, { type: 'max', value: 9.99 } ]
      };
      
      expect((await parseRequestSchema(schemaFloat, 5.5, context)).success).toBe(true);
      expect((await parseRequestSchema(schemaFloat, 9.99, context)).success).toBe(true);
      expect((await parseRequestSchema(schemaFloat, 10, context)).success).toBe(false);
    });

    test('Boolean validation', async () => {
      const schema = { dataType: 'bool' };
      expect((await parseRequestSchema(schema, true, context)).success).toBe(true);
      expect((await parseRequestSchema(schema, false, context)).success).toBe(true);
      expect((await parseRequestSchema(schema, 'true', context)).success).toBe(false); // strict typing
    });

    test('Enum validation (strings and numbers)', async () => {
      const schemaStrEnum = {
        dataType: 'enum',
        rules: [ { type: 'values', value: ['admin', 'user', 'guest'] } ]
      };

      expect((await parseRequestSchema(schemaStrEnum, 'user', context)).success).toBe(true);
      expect((await parseRequestSchema(schemaStrEnum, 'superadmin', context)).success).toBe(false);

      const schemaNumEnum = {
        dataType: 'enum',
        rules: [ { type: 'values', value: [1, 2, 3] } ]
      };

      expect((await parseRequestSchema(schemaNumEnum, 2, context)).success).toBe(true);
      expect((await parseRequestSchema(schemaNumEnum, 4, context)).success).toBe(false);
    });
  });

  describe('Complex Structural Types (Objects and Arrays)', () => {
    test('Nested Arrays with max/min items and item typing', async () => {
      const schema = {
        dataType: 'arr',
        rules: [ { type: 'minItems', value: 1 }, { type: 'maxItems', value: 3 } ],
        items: { key: '', dataType: 'int', rules: [{ type: 'min', value: 5 }] }
      };

      expect((await parseRequestSchema(schema, [5, 10], context)).success).toBe(true);
      expect((await parseRequestSchema(schema, [], context)).success).toBe(false); // minItems
      expect((await parseRequestSchema(schema, [5, 10, 15, 20], context)).success).toBe(false); // maxItems
      expect((await parseRequestSchema(schema, [5, '10'], context)).success).toBe(false); // wrong item type
      expect((await parseRequestSchema(schema, [4], context)).success).toBe(false); // item below min rule
    });

    test('Deeply nested objects and arrays combined', async () => {
      const schema = {
        dataType: 'object',
        properties: [
          { key: 'id', dataType: 'int', required: true },
          { key: 'tags', dataType: 'arr', required: false, items: { key: '', dataType: 'str', rules: [{ type: 'minLength', value: 2 }] } },
          { 
            key: 'metadata', 
            dataType: 'object', 
            required: true,
            properties: [
              { key: 'createdAt', dataType: 'str', required: true },
              { key: 'flags', dataType: 'arr', required: true, items: { key: '', dataType: 'bool' } }
            ]
          }
        ]
      };

      const validPayload = {
        id: 123,
        tags: ['js', 'ts'],
        metadata: {
          createdAt: '2023-01-01',
          flags: [true, false, true]
        }
      };

      expect((await parseRequestSchema(schema, validPayload, context)).success).toBe(true);

      const invalidPayload1 = { ...validPayload, tags: ['a'] }; // tag too short
      expect((await parseRequestSchema(schema, invalidPayload1, context)).success).toBe(false);

      const invalidPayload2 = { ...validPayload, metadata: { createdAt: '2023-01-01' } }; // missing flags array
      expect((await parseRequestSchema(schema, invalidPayload2, context)).success).toBe(false);
    });
  });

  describe('Custom JavaScript Validations in VM', () => {
    test('Returns boolean pass/fail', async () => {
      const schema = {
        dataType: 'js',
        js: 'return input && input.startsWith("token_");'
      };

      expect((await parseRequestSchema(schema, 'token_123', context)).success).toBe(true);
      
      const failResult = await parseRequestSchema(schema, 'bad_token', context);
      expect(failResult.success).toBe(false);
      expect(failResult.errors?.[0]?.errors?.[0]).toBe('Custom JS validation failed');
    });

    test('Intercepts thrown standard Error', async () => {
      const schema = {
        dataType: 'js',
        js: 'if (input < 18) throw new Error("Must be 18 or older"); return true;'
      };
      
      const result = await parseRequestSchema(schema, 16, context);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.errors?.[0]).toBe('Must be 18 or older');
    });

    test('Intercepts custom ValidationError and extracts payload', async () => {
      const schema = {
        dataType: 'js',
        js: `
          if (input.email !== "admin@test.com") {
            throw { 
              name: "ValidationError", 
              payload: { code: "UNAUTHORIZED", message: "Invalid admin email" } 
            };
          }
          return true;
        `
      };

      const result = await parseRequestSchema(schema, { email: 'hacker@test.com' }, context);
      expect(result.success).toBe(false);
      
      const customPayload = result.errors?.[0]?.errors?.[0];
      expect(customPayload).toEqual({ code: 'UNAUTHORIZED', message: 'Invalid admin email' });
    });

    test('Handles syntax errors gracefully', async () => {
      const schema = {
        dataType: 'js',
        js: 'this is not valid javascript syntax;'
      };

      const result = await parseRequestSchema(schema, 'test', context);
      expect(result.success).toBe(false);
      // It should capture the JS execution error gracefully instead of crashing the server
      expect(result.errors?.[0]?.errors?.[0]).toContain('Unexpected identifier'); 
    });
  });

  describe('DB Zod Schema Protection', () => {
    test('Rejects malformed JSON definitions entirely before execution', async () => {
      const malformedSchema = {
        dataType: 'imaginary_type',
        properties: 'should be an array'
      };

      const result = await parseRequestSchema(malformedSchema, {}, context);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.errors?.[0]).toBe('Invalid schema definition format');
    });
  });
});
