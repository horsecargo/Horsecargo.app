import pg from 'pg';
import fs from 'node:fs/promises';
const url=process.env.HC_TEST_DATABASE_URL||'postgres://postgres:local-test-only@127.0.0.1:55439/hc';
const target=new URL(url);
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='55439'||target.pathname!=='/hc')
  throw Error('Setup only supports the isolated loopback hc database on port 55439');
const c=new pg.Client({connectionString:url});await c.connect();
try {
  await c.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;');
  const shim=(await fs.readFile('test/supabase_shim.sql','utf8')).replace(/create role (\w+) nologin;/g,
    (_,role)=>`do $$ begin create role ${role} nologin; exception when duplicate_object then null; end $$;`);
  await c.query(shim);
  for(const file of ['schema.sql','seed.sql','accounting-1-roles.sql','accounting-2.sql','shipments-v2.sql','documents-v3.sql','staff-storage-v4.sql','documents-packing-v5.sql','crm-mail-v6-1-roles.sql','crm-mail-v6-2.sql'])
    await c.query(await fs.readFile('supabase/'+file,'utf8'));
  await c.query(await fs.readFile('test/v5_users.sql','utf8'));
  await c.query(await fs.readFile('test/v4_helpers.sql','utf8'));
  await c.query(await fs.readFile('test/v6_users.sql','utf8'));
  console.log('Isolated test database reset and v1-v6 migrations installed.');
} finally {await c.end();}
