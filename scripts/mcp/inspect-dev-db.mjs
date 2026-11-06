/**
 * Step 4 — inspect the connected development database through MCP.
 *
 * Uses ONLY read/metadata tools. Nothing is created, written, deleted or
 * re-indexed. Run: node scripts/mcp/inspect-dev-db.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SDK_ROOT = resolve(ROOT, 'node_modules', '.pnpm', '@modelcontextprotocol+sdk@1.32.1_zod@4.6.7',
  'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');

const { Client } = await import(`file:///${SDK_ROOT}/index.js`);
const { StdioClientTransport } = await import(`file:///${SDK_ROOT}/stdio.js`);

function loadEnvFile(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.substring(eq + 1).trim();
    const first = value[0];
    if ((first === '"' && value.endsWith('"')) || (first === "'" && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.substring(0, eq).trim()] = value;
  }
  return out;
}

const cfg = JSON.parse(readFileSync(resolve(ROOT, '.cursor', 'mcp.json'), 'utf8')).mcpServers.mongodb;
const env = { ...loadEnvFile(resolve(ROOT, '.env.mcp')), ...cfg.env };
const DB = 'ajooba_development';

const transport = new StdioClientTransport({
  command: cfg.command,
  args: cfg.args.map((a) => a.replace('${workspaceFolder}', ROOT)),
  env: { ...process.env, ...env },
  stderr: 'ignore',
});
const client = new Client({ name: 'ajooba-inspect', version: '1.0.0' });
await client.connect(transport);

/** Call a tool and print its text payload. */
async function run(name, args, limit = 3000) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
  const clean = text.replace(/<untrusted-user-data-[^>]+>/g, '').replace(/<\/untrusted-user-data-[^>]+>/g, '')
    .replace(/^\s*\[?\s*/, '');
  console.log(`\n--- ${name} ${JSON.stringify(args)} ---`);
  console.log(`isError=${res.isError ?? false}`);
  console.log(clean.slice(0, limit));
  return clean;
}

const { tools } = await client.listTools();
console.log(`=== Tools available (${tools.length}) ===`);
console.log(tools.map((t) => t.name).join(', '));

await run('find', { database: DB, collection: 'products', limit: 2, projection: { title: 1, slug: 1, sellingPrice: 1 } });
await run('count', { database: DB, collection: 'products' });
await run('count', { database: DB, collection: 'variants' });
await run('count', { database: DB, collection: 'import-reports' });
await run('collection-indexes', { database: DB, collection: 'products' });
await run('collection-indexes', { database: DB, collection: 'variants' });
await run('collection-indexes', { database: DB, collection: 'import-reports' });

await client.close();