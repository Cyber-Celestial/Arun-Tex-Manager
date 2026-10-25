import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import pg from 'pg';
import { createClerkClient } from '@clerk/backend';
import { Storage } from '@google-cloud/storage';

const root = resolve(import.meta.dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return number;
}

// No application test routes, auth bypasses, or writes to the staff workspace.
export async function environment() {
  for (const key of ['DATABASE_URL', 'CLERK_SECRET_KEY', 'VITE_CLERK_PUBLISHABLE_KEY', 'PRIVATE_OBJECT_DIR']) {
    if (!process.env[key]) throw new Error(`Missing required test environment: ${key}`);
  }
  if (!process.env.CLERK_SECRET_KEY.startsWith('sk_test_')) {
    throw new Error('Dispatch regression tests require a development Clerk instance, never production.');
  }
  const id = randomUUID().replaceAll('-', '');
  const schema = `dispatch_e2e_${id}`;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const users = [];
  const children = [];
  let gateway;
  const privateDir = `${process.env.PRIVATE_OBJECT_DIR.replace(/\/$/, '')}/dispatch-e2e/${id}`;
  const [bucketName, ...parts] = privateDir.replace(/^\//, '').split('/');
  const prefix = `${parts.join('/')}/`;
  const storage = new Storage({
    projectId: '',
    credentials: {
      audience: 'replit', subject_token_type: 'access_token', type: 'external_account',
      token_url: 'http://127.0.0.1:1106/token',
      credential_source: { url: 'http://127.0.0.1:1106/credential', format: { type: 'json', subject_token_field_name: 'access_token' } },
      universe_domain: 'googleapis.com',
    },
  });
  let cleanupPromise;
  function cleanup() {
    return cleanupPromise ??= (async () => {
      const errors = [];
      // Try every cleanup even if one external service fails.
      async function attempt(name, work) {
        try { await work(); } catch { errors.push(name); }
      }
      if (gateway) await attempt('local gateway', async () => {
        gateway.closeAllConnections();
        await new Promise(resolve => gateway.close(resolve));
      });
      for (const child of children) await attempt('test server', async () => {
        if (child.exitCode !== null) return;
        child.kill('SIGTERM');
        await Promise.race([once(child, 'exit'), wait(3000)]);
        if (child.exitCode === null) child.kill('SIGKILL');
      });
      await attempt('synthetic uploaded PDFs', async () => {
        const bucket = storage.bucket(bucketName);
        const [files] = await bucket.getFiles({ prefix });
        await Promise.all(files.map(file => file.delete({ ignoreNotFound: true })));
        const [remaining] = await bucket.getFiles({ prefix });
        if (remaining.length) throw new Error('Objects remain');
      });
      for (const user of users) await attempt('synthetic Clerk account', () => clerk.users.deleteUser(user.id));
      await attempt('temporary database schema', () => pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
      await pool.end();
      if (errors.length) throw new Error(`Test cleanup failed: ${errors.join(', ')}. Run ID: ${id}`);
      console.log('Cleaned synthetic accounts, private PDFs and isolated database schema.');
    })();
  }
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    // Copy current definitions and defaults, never staff rows.
    for (const table of ['workspace_users', 'operations_state']) {
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    for (const role of ['billing', 'pending']) {
      const user = await clerk.users.createUser({
        emailAddress: [`dispatch-${id}-${role}+clerk_test@example.com`],
        firstName: 'Synthetic', lastName: 'Dispatch', skipPasswordRequirement: true,
      });
      users.push(user);
      await pool.query(`INSERT INTO "${schema}".workspace_users (user_id,name,email,role) VALUES ($1,$2,$3,$4)`,
        [user.id, 'Synthetic Dispatch', user.emailAddresses[0].emailAddress, role]);
    }
    const apiPort = await port();
    const webPort = await port();
    function start(command, args, env) {
      const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' });
      children.push(child);
      child.on('error', () => {}); // Readiness check reports startup failures without leaking environment.
      return child;
    }
    start('node', ['artifacts/api-server/dist/index.mjs'], {
      NODE_ENV: 'development', PORT: String(apiPort), PGOPTIONS: `-c search_path=${schema}`,
      PRIVATE_OBJECT_DIR: privateDir,
    });
    // Launch Vite directly so cleanup owns the actual process, not a package-manager parent.
    start('node', ['artifacts/arun-tex-management/node_modules/vite/bin/vite.js',
      '--config', 'artifacts/arun-tex-management/vite.config.ts'], {
      NODE_ENV: 'development', PORT: String(webPort), BASE_PATH: '/',
      VITE_CLERK_PROXY_URL: '',
    });
    for (const [target, path] of [[apiPort, '/api/healthz'], [webPort, '/']]) {
      let ready = false;
      for (let i = 0; i < 120; i++) {
        try { ready = (await fetch(`http://127.0.0.1:${target}${path}`)).ok; } catch {}
        if (ready) break;
        if (children.some(child => child.exitCode !== null)) throw new Error('An isolated test server exited during startup.');
        await wait(250);
      }
      if (!ready) throw new Error(`Isolated test server did not become ready (${path}).`);
    }
    gateway = createServer((req, res) => {
      const upstream = request({
        hostname: '127.0.0.1', port: req.url.startsWith('/api/') ? apiPort : webPort,
        path: req.url, method: req.method, headers: req.headers,
      }, response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(upstream);
    });
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    return {
      baseURL: `http://127.0.0.1:${gateway.address().port}`, cleanup,
      async ticket(role = 'billing') {
        return (await clerk.signInTokens.createSignInToken({
          userId: users[role === 'billing' ? 0 : 1].id, expiresInSeconds: 120,
        })).token;
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
