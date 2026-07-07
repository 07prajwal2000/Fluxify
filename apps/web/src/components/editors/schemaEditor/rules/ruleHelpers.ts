import { Rule } from '../../../../types/schemaEditor';

export const getRuleValue = (rules: Rule[] | undefined, type: string, defaultValue: any = '') => {
  if (!rules) return defaultValue;
  const rule = rules.find(r => r.type === type);
  return rule ? rule.value : defaultValue;
};

export const updateRule = (rules: Rule[] | undefined, type: string, value: any): Rule[] => {
  const newRules = rules ? [...rules] : [];
  const index = newRules.findIndex(r => r.type === type);
  
  // Remove rule if value is empty/null/undefined (but allow 0 or false)
  if (value === '' || value === undefined || value === null) {
    if (index >= 0) newRules.splice(index, 1);
  } else {
    if (index >= 0) {
      newRules[index] = { ...newRules[index], value };
    } else {
      newRules.push({ type, value });
    }
  }
  return newRules;
};
