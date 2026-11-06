/**
 * End-to-end MCP connection test.
 *
 * Mirrors what Cursor does with `.cursor/mcp.json`:
 *   1. load the `envFile` (.env.mcp)
 *   2. spawn the server over stdio with those variables
 *   3. complete the MCP handshake
 *   4. exercise read-only tools and assert a write is REFUSED
 *
 * Run: node scripts/mcp/verify-mcp-connection.mjs
 * Exits non-zero if any check fails.
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

/** Parse an env file the same way Cursor's MCPService.loadEnvFile does. */
function loadEnvFile(file) {
  const out = {};
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.substring(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(0, -1);
    out[line.substring(0, eq).trim()] = value;
  }
  return out;
}

const config = JSON.parse(readFileSync(resolve(ROOT, '.cursor', 'mcp.json'), 'utf8'));
const entry = config.mcpServers.mongodb;
const serverArgs = entry.args.map((a) => a.replace('${workspaceFolder}', ROOT));

const env = {
  ...loadEnvFile(resolve(ROOT, entry.envFile.replace('${workspaceFolder}', ROOT))),
  ...entry.env,
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};

console.log('=== MongoDB MCP connection verification ===\n');
console.log(`connection target : ${env.MDB_MCP_CONNECTION_STRING.replace(/\/\/[^@]*@/, '//<redacted>@')}`);
console.log(`read-only flag    : ${env.MDB_MCP_READ_ONLY}`);
console.log(`server            : ${entry.command} ${serverArgs[0]}\n`);

const transport = new StdioClientTransport({
  command: entry.command,
  args: serverArgs,
  env: { ...process.env, ...env },
  stderr: 'ignore',
});

const client = new Client({ name: 'ajooba-mcp-verify', version: '1.0.0' });
await client.connect(transport);
check('MCP handshake completed', true);

// ---- server configuration echo -----------------------------------------
// ---- tool inventory ------------------------------------------------------
const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log(`\ntools exposed: ${names.length}`);
check('read-only excludes write tools',
  !names.some((n) => ['insert-one', 'insert-many', 'update-one', 'update-many',
    'delete-one', 'delete-many', 'drop-collection', 'drop-database',
    'create-index', 'drop-index', 'drop-indexes', 'rename-collection'].includes(n)),
  'verified against the live tool list');

// ---- server identity -----------------------------------------------------
const build = await client.callTool({ name: 'server-info', arguments: {} });
const infoText = (build.content ?? []).map((c) => c.text ?? '').join('\n');
console.log(`\nserver-info: ${infoText.slice(0, 400)}\n`);

// ---- read the catalogue --------------------------------------------------
const listDb = await client.callTool({ name: 'list-databases', arguments: {} });
const dbText = (listDb.content ?? []).map((c) => c.text ?? '').join('\n');
console.log(`list-databases:\n${dbText.slice(0, 800)}\n`);
check('list-databases responded', !listDb.isError, listDb.isError ? 'tool errored' : 'ok');

// ---- a write must be refused -------------------------------------------
const write = await client.callTool({
  name: 'insert-one',
  arguments: { database: 'ajooba_development', collection: 'products', document: { probe: 1 } },
});
const writeText = (write.content ?? []).map((c) => c.text ?? '').join('\n');
console.log(`\ninsert-one attempt -> isError=${write.isError}\n${writeText.slice(0, 300)}\n`);
check('write refused in read-only mode', Boolean(write.isError));

await client.close();
console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
process.exit(failures === 0 ? 0 : 1);