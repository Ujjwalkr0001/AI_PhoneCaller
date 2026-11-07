import { z } from 'zod';
import { campaignSchema, contactSchema, destinationSchema } from '../../../packages/shared/src/index.js';
export function openApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  const routes = [
    ['get', '/campaigns'], ['post', '/campaigns', 'Campaign'], ['get', '/campaigns/{id}'], ['put', '/campaigns/{id}', 'Campaign'], ['delete', '/campaigns/{id}'],
    ...['launch', 'pause', 'resume', 'stop'].map(a => ['post', `/campaigns/{id}/${a}`]), ['post', '/campaigns/{id}/contacts', 'ContactList'],
    ['get', '/contacts'], ['post', '/contacts/validate', 'ContactList'], ['delete', '/contacts/{id}'], ['get', '/calls'], ['get', '/calls/{id}'], ['delete', '/calls/{id}'],
    ['get', '/results'], ['get', '/results/export'], ['get', '/suppression'], ['post', '/suppression'], ['delete', '/suppression/{id}'],
    ['get', '/destinations'], ['post', '/destinations', 'Destination'], ['delete', '/destinations/{id}'], ['post', '/destinations/{id}/test'],
    ['get', '/deliveries'], ['post', '/deliveries/{id}/retry'], ['get', '/settings'], ['put', '/settings'], ['get', '/team'], ['get', '/audit-log'], ['get', '/providers'], ['get', '/analytics'],
    ['get', '/auth/me'], ['post', '/auth/logout'], ['post', '/voice-preview'], ['get', '/openapi.json'],
  ];
  for (const [method, path, body] of routes) {
    const key = `/api/v1${path}`; paths[key] ??= {};
    paths[key][method] = { summary: `${method.toUpperCase()} ${path}`, parameters: [
      ...(path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] : []),
      ...(['post', 'put', 'delete'].includes(method) ? [{ name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } }] : []),
      ...(/launch|resume/.test(path) ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8 } }] : []),
    ], ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${body}` } } } } } : {}),
    responses: { '200': { description: path.includes('export') ? 'UTF-8 CSV download' : 'Success' }, '400': { description: 'Validation or gate failure' }, '401': { description: 'Authentication required' }, '403': { description: 'Role/CSRF check failed' } } };
  }
  paths['/api/v1/auth/login'] = { post: { security: [], summary: 'Email/password login; rate limited', responses: { '200': { description: 'Sets httpOnly session cookie; returns CSRF token, role, email' }, '401': { description: 'Invalid credentials' }, '429': { description: 'Rate limited' } } } };
  for (const path of ['/healthz', '/readyz']) paths[path] = { get: { security: [], responses: { '200': { description: 'Healthy/ready' }, '503': { description: 'Not ready' } } } };
  return { openapi: '3.1.0', info: { title: 'Campaign Studio', version: '1.0.0', description: 'Org-scoped API. JSONB payload contracts generated from shared Zod schemas; additional route bodies documented in docs/API.md.' },
    components: { schemas: { Campaign: z.toJSONSchema(campaignSchema), Contact: z.toJSONSchema(contactSchema), ContactList: { type: 'array', items: { $ref: '#/components/schemas/Contact' } }, Destination: z.toJSONSchema(destinationSchema) }, securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' } } }, security: [{ cookieAuth: [] }], paths };
}
