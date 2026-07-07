import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { createContext, useContext, useRef, ReactNode } from 'react';
import { ValidationSchema, SchemaProperty, DataType } from '../../../types/schemaEditor';
import { produce } from 'immer';
// No uuid needed, using Math.random for client-side IDs

// Simple ID generator since uuid might not be installed
const generateId = () => Math.random().toString(36).substring(2, 9);

interface SchemaEditorState {
  schema: ValidationSchema;
  path: (number | 'items')[]; // Navigates through 'properties' (number index) or 'items' ('items' literal)
  drawerOpen: boolean;
  activePropertyPath: (number | 'items')[] | null; 
  locked: boolean;
  typeOverrides: Record<string, DataType[]>;
  allowedRootSchemaTypes?: DataType[];
  
  // Actions
  setSchema: (schema: ValidationSchema) => void;
  addProperty: (currentPath: (number | 'items')[]) => void;
  removeProperty: (targetPath: (number | 'items')[]) => void;
  updateProperty: (targetPath: (number | 'items')[], updates: Partial<SchemaProperty>) => void;
  
  // UI Actions
  pushPath: (segment: number | 'items') => void;
  popPath: () => void;
  goToPath: (level: number) => void;
    openDrawer: (targetPath: (number | 'items')[]) => void;
    closeDrawer: () => void;
  }
  
  export const createSchemaStore = (initialSchema?: ValidationSchema, locked: boolean = false, typeOverrides: Record<string, DataType[]> = {}, allowedRootSchemaTypes?: DataType[]) => {
    const defaultSchema: ValidationSchema = {
      dataType: 'object',
      properties: []
    };
  
    return createStore<SchemaEditorState>((set) => ({
      schema: initialSchema || defaultSchema,
      locked,
      typeOverrides,
      allowedRootSchemaTypes,
      path: [],
      drawerOpen: false,
      activePropertyPath: null,
  
      setSchema: (schema) => set({ schema }),
  
      addProperty: (currentPath) => set(produce((state: SchemaEditorState) => {
        let target: any = state.schema;
        for (const segment of currentPath) {
          if (segment === 'items') {
            if (!target.items) target.items = { dataType: 'str' };
            target = target.items;
          } else {
            if (!target.properties) target.properties = [];
            target = target.properties[segment];
          }
        }
        
        if (!target.properties) target.properties = [];
        target.properties.push({
          id: generateId(),
          key: '',
          dataType: 'str',
          rules: [],
          required: false
        });
      })),
  
      removeProperty: (targetPath) => set(produce((state: SchemaEditorState) => {
        if (targetPath.length === 0) return;
        const lastSegment = targetPath[targetPath.length - 1];
        const parentPath = targetPath.slice(0, -1);
        
        let parent: any = state.schema;
        for (const segment of parentPath) {
          if (segment === 'items') parent = parent.items;
          else parent = parent.properties[segment];
        }
        
        if (lastSegment === 'items') {
          delete parent.items;
        } else if (parent.properties) {
          parent.properties.splice(lastSegment as number, 1);
        }
      })),
  
      updateProperty: (targetPath, updates) => set(produce((state: SchemaEditorState) => {
        let target: any = state.schema;
        for (const segment of targetPath) {
          if (segment === 'items') {
            if (!target.items) target.items = {};
            target = target.items;
          } else {
            if (!target.properties) target.properties = [];
            target = target.properties[segment];
          }
        }
        
        Object.assign(target, updates);
      })),
  
      pushPath: (segment) => set(produce((state: SchemaEditorState) => {
        state.path.push(segment);
      })),
  
      popPath: () => set(produce((state: SchemaEditorState) => {
        state.path.pop();
      })),
  
      goToPath: (level) => set(produce((state: SchemaEditorState) => {
        state.path = state.path.slice(0, level);
      })),
  
      openDrawer: (targetPath) => set({ drawerOpen: true, activePropertyPath: targetPath }),
      closeDrawer: () => set({ drawerOpen: false, activePropertyPath: null })
    }));
  };

export type SchemaEditorStore = ReturnType<typeof createSchemaStore>;

export const SchemaEditorContext = createContext<SchemaEditorStore | null>(null);

export function useSchemaEditorStore<T>(selector: (state: SchemaEditorState) => T): T {
  const store = useContext(SchemaEditorContext);
  if (!store) throw new Error('Missing SchemaEditorContext.Provider in the tree');
  return useStore(store, selector);
}

export function useSchemaEditorStoreApi() {
  const store = useContext(SchemaEditorContext);
  if (!store) throw new Error('Missing SchemaEditorContext.Provider in the tree');
  return store;
}
