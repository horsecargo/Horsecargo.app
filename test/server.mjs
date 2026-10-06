// LOCAL TEST ONLY: a small Supabase-compatible adapter over the real PostgreSQL
// schema/RLS/RPCs. Bind loopback, use the isolated database from README-test.md.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
pg.types.setTypeParser(1082,v=>v); // DATE as 'YYYY-MM-DD', like PostgREST
const pool=new pg.Pool({connectionString:process.env.HC_TEST_DATABASE_URL||'postgres://postgres:local-test-only@127.0.0.1:55439/hc'});
const root=path.resolve('www');
const quote=s=>{if(!/^[a-z_][a-z_0-9]*$/i.test(s))throw Error('Invalid identifier');return `"${s}"`;};
const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:8787');
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers','Content-Range');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  let client;
  try {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{};
    if(url.pathname.startsWith('/auth/v1')) {
      if(url.pathname.endsWith('/logout'))return json(res,200,{});
      const uid=req.headers.authorization?.replace(/^Bearer /,'').replace(/^test:/,'');
      if(url.pathname.endsWith('/user')) {
        const {rows}=await pool.query('select id,email,raw_user_meta_data as user_metadata from auth.users where id=$1',[uid]);
        return json(res,200,rows[0]);
      }
      if(url.pathname.endsWith('/signup')) {
        const {rows}=await pool.query("insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values(gen_random_uuid(),$1,crypt($2,gen_salt('bf')),$3) returning id,email,raw_user_meta_data as user_metadata",[body.email,body.password,body.data||{}]);
        return json(res,200,rows[0]);
      }
      const {rows}=await pool.query('select id,email,raw_user_meta_data as user_metadata from auth.users where email=$1 and encrypted_password=crypt($2,encrypted_password)',[body.email,body.password]);
      if(!rows.length)return json(res,400,{message:'Invalid login credentials'});
      return json(res,200,{access_token:`test:${rows[0].id}`,refresh_token:`test:${rows[0].id}`,token_type:'bearer',expires_in:86400,user:rows[0]});
    }
    if(url.pathname.startsWith('/rest/v1/')) {
      client=await pool.connect();await client.query('begin');
      const token=req.headers.authorization?.replace(/^Bearer /,'');
      const uid=token?.startsWith('test:')?token.slice(5):'';
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
      await client.query(`set local role ${uid?'authenticated':'anon'}`);
      let rows;let count;
      if(url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn=quote(url.pathname.split('/').pop());const keys=Object.keys(body);
        const sql=`select public.${fn}(${keys.map((k,n)=>`${quote(k)} := $${n+1}`).join(',')}) as result`;
        rows=(await client.query(sql,keys.map(k=>typeof body[k]==='object'&&body[k]!==null?JSON.stringify(body[k]):body[k]))).rows;
        await client.query('commit');return json(res,200,rows[0]?.result);
      }
      const table=quote(url.pathname.split('/').pop());const args=[];const clauses=[];
      for(const [key,value] of url.searchParams) {
        if(['select','order','limit','offset'].includes(key))continue;
        if(key==='or') {
          const choices=value.replace(/^\(|\)$/g,'').split(',').map(term=>{const [col,op,...v]=term.split('.');const sqlOp={ilike:'ilike',eq:'='}[op];if(!sqlOp)throw Error('Unsupported or');args.push(v.join('.').replace(/\*/g,'%'));return `${quote(col)}::text ${sqlOp} $${args.length}`;});
          clauses.push(`(${choices.join(' or ')})`);continue;
        }
        const [op,...parts]=value.split('.');const v=parts.join('.');
        if(op==='in') {const vals=v.slice(1,-1).split(',');clauses.push(`${quote(key)} in (${vals.map(x=>{args.push(x);return '$'+args.length;}).join(',')})`);continue;}
        if(op==='is') {clauses.push(`${quote(key)} is ${v==='null'?'null':v==='true'?'true':'false'}`);continue;}
        const operator={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',ilike:'ilike'}[op];if(!operator)throw Error('Unsupported filter');
        args.push(v);clauses.push(`${quote(key)} ${operator} $${args.length}`);
      }
      const where=clauses.length?' where '+clauses.join(' and '):'';
      if(req.method==='GET'||req.method==='HEAD') {
        const cols=url.searchParams.get('select')||'*';const select=cols==='*'?'*':cols.split(',').map(quote).join(',');
        const order=url.searchParams.get('order')?.split(',').map(x=>{const [col,dir]=x.split('.');return `${quote(col)} ${dir==='desc'?'desc':'asc'}`;}).join(',');
        const limit=Math.min(Number(url.searchParams.get('limit')||10000),10000);const offset=Number(url.searchParams.get('offset')||0);
        count=Number((await client.query(`select count(*) from public.${table}${where}`,args)).rows[0].count);
        rows=(await client.query(`select ${select} from public.${table}${where}${order?' order by '+order:''} limit ${limit} offset ${offset}`,args)).rows;
      } else if(req.method==='POST') {
        const keys=Object.keys(body);rows=(await client.query(`insert into public.${table}(${keys.map(quote).join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,keys.map(k=>body[k]))).rows;
      } else if(req.method==='PATCH') {
        const sets=Object.keys(body).map(k=>{args.push(body[k]);return `${quote(k)}=$${args.length}`;});
        rows=(await client.query(`update public.${table} set ${sets.join(',')}${where} returning *`,args)).rows;
      } else if(req.method==='DELETE') rows=(await client.query(`delete from public.${table}${where} returning *`,args)).rows;
      await client.query('commit');
      if(req.headers.accept?.includes('vnd.pgrst.object')) {
        if(rows.length!==1)return json(res,406,{code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned',details:`The result contains ${rows.length} rows`});
        return json(res,200,rows[0]);
      }
      return json(res,200,rows,{'Content-Range':`0-${Math.max(0,rows.length-1)}/${count??rows.length}`});
    }
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    let content=await fs.readFile(file);
    if(url.pathname==='/config.js')content=Buffer.from("window.HC_CONFIG={SUPABASE_URL:'http://127.0.0.1:8787',SUPABASE_ANON_KEY:'anon',PUBLIC_TRACK_URL:'http://127.0.0.1:8787/track.html'};");
    const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime});res.end(content);
  } catch(err) {
    if(client)await client.query('rollback');
    if(process.env.HC_TEST_LOG)console.error(req.method,req.url,'→',err.message);
    json(res,400,{message:err.message,code:err.code||'TEST_ERROR'});
  } finally {client?.release();}
}).listen(8787,'127.0.0.1',()=>console.log('Horse Cargo local test server http://127.0.0.1:8787'));
