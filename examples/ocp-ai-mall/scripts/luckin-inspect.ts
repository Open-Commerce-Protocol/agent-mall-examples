import { LuckinMcpProbe } from '../packages/luckin-adapter/src/probe';
import { loadLuckinCredential } from '../apps/luckin-merchant-api/src/credentials';
const args = process.argv.slice(2);
const index = args.indexOf('--config');
const token = await loadLuckinCredential(index < 0 ? undefined : args[index + 1]);
const result = await new LuckinMcpProbe(async () => token).inspect();
// Schema-only diagnostic. Never invokes tools/call or reads orders.
console.log(JSON.stringify({ environment: 'live', authenticated: true, business_tools_called: false,
  tools: result.tools.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema, hasOutputSchema: Boolean(tool.outputSchema), fingerprint: result.fingerprints[tool.name] })) }, null, 2));
