<template>
  <div class="key-generator-container">
    <div class="key-generator-controls">
      <div class="field-group">
        <label for="key-type-select" class="field-label">Select Key Type</label>
        <select id="key-type-select" v-model="selectedKeyType" class="key-select">
          <option value="MASTER_ENCRYPTION_KEY">Master Encryption Key (32-byte Base64)</option>
          <option value="BETTER_AUTH_SECRET">Better Auth Secret (High-Entropy Secret)</option>
          <option value="SYSTEM_ACCESS_KEY">System Access Key (M2M Key)</option>
          <option value="ALL">All Security Keys (.env format)</option>
        </select>
      </div>

      <button type="button" @click="generateKey" class="generate-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon">
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
          <path d="M16 16h5v5"/>
        </svg>
        Generate Key
      </button>
    </div>

    <div v-if="outputCode" class="generated-output">
      <div class="output-header">
        <span class="output-title">Generated Secret</span>
        <button type="button" @click="copyToClipboard" class="copy-btn">
          <svg v-if="!copied" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="check-icon">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>

      <div class="code-wrapper vp-code-block">
        <pre><code class="language-env">{{ outputCode }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const selectedKeyType = ref<string>('MASTER_ENCRYPTION_KEY');
const outputCode = ref<string>('');
const copied = ref<boolean>(false);

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

function generateAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = getRandomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function generateMasterKey(): string {
  // 32-byte cryptographically random base64 string
  return bytesToBase64(getRandomBytes(32));
}

function generateBetterAuthSecret(): string {
  // High-entropy 32-character secret key for Better Auth
  return generateAlphanumeric(32);
}

function generateSystemAccessKey(): string {
  // 32-character alphanumeric key for M2M authentication
  return generateAlphanumeric(32);
}

function generateKey() {
  copied.value = false;
  if (selectedKeyType.value === 'MASTER_ENCRYPTION_KEY') {
    outputCode.value = `MASTER_ENCRYPTION_KEY=${generateMasterKey()}`;
  } else if (selectedKeyType.value === 'BETTER_AUTH_SECRET') {
    outputCode.value = `BETTER_AUTH_SECRET=${generateBetterAuthSecret()}`;
  } else if (selectedKeyType.value === 'SYSTEM_ACCESS_KEY') {
    outputCode.value = `SYSTEM_ACCESS_KEY=${generateSystemAccessKey()}`;
  } else if (selectedKeyType.value === 'ALL') {
    outputCode.value = `# Generated Security Keys\nMASTER_ENCRYPTION_KEY=${generateMasterKey()}\nBETTER_AUTH_SECRET=${generateBetterAuthSecret()}\nSYSTEM_ACCESS_KEY=${generateSystemAccessKey()}`;
  }
}

async function copyToClipboard() {
  if (!outputCode.value) return;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(outputCode.value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = outputCode.value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy key:', err);
  }
}
</script>

<style scoped>
.key-generator-container {
  margin: 1.5rem 0;
  padding: 1.25rem;
  border-radius: 8px;
  background-color: var(--vp-c-bg-soft, #f6f6f7);
  border: 1px solid var(--vp-c-divider, rgba(60, 60, 67, 0.12));
}

.key-generator-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-end;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex: 1;
  min-width: 240px;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--vp-c-text-1, rgba(60, 60, 67));
}

.key-select {
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider, #ccc);
  background-color: var(--vp-c-bg, #fff);
  color: var(--vp-c-text-1, #333);
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.key-select:focus {
  border-color: var(--vp-c-brand-1, #3eaf7c);
  box-shadow: 0 0 0 2px var(--vp-c-brand-soft, rgba(62, 175, 124, 0.2));
}

.generate-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 600;
  border-radius: 6px;
  background-color: var(--vp-c-brand-1, #3eaf7c);
  color: var(--vp-button-brand-text, #fff);
  border: none;
  cursor: pointer;
  transition: background-color 0.2s, transform 0.1s;
}

.generate-btn:hover {
  background-color: var(--vp-c-brand-2, #349669);
}

.generate-btn:active {
  transform: scale(0.98);
}

.btn-icon {
  flex-shrink: 0;
}

.generated-output {
  margin-top: 1.25rem;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider, rgba(60, 60, 67, 0.12));
  background-color: var(--vp-code-block-bg, #1e1e20);
}

.output-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background-color: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.output-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-2, rgba(235, 235, 245, 0.6));
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--vp-c-text-2, #aaa);
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn:hover {
  color: var(--vp-c-text-1, #fff);
  border-color: rgba(255, 255, 255, 0.3);
}

.check-icon {
  color: #42b883;
}

.code-wrapper {
  padding: 0.75rem 1rem;
  overflow-x: auto;
}

.code-wrapper pre {
  margin: 0;
  padding: 0;
  font-family: var(--vp-font-family-mono, monospace);
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--vp-code-color, #e1e1e1);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
