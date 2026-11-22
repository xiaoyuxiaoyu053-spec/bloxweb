const express=require('express'),http=require('http'),{WebSocketServer}=require('ws'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const DB=process.env.DATA_FILE||path.join(__dirname,'data.json');
let db={users:{},admin:null,world:null};
try{Object.assign(db,JSON.parse(fs.readFileSync(DB,'utf8')))}catch{}
const save=()=>{try{fs.writeFileSync(DB,JSON.stringify(db))}catch(e){console.error(e.message)}};
const rnd=()=>crypto.randomBytes(24).toString('hex');
const hs=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const same=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const setAdmin=pw=>{const s=rnd();db.admin={s,h:hs(pw,s)};save()};
if(!db.admin){setAdmin(process.env.ADMIN_PASSWORD||'changeme');if(!process.env.ADMIN_PASSWORD)console.warn('Admin password is "changeme" - change it at /admin')}
if(!db.world)db.world={spawn:[0,6,0],parts:[{p:[0,-2,0],s:[512,4,512],c:'#4f7a3a'},{p:[0,.5,-12],s:[8,1,8],c:'#a3a2a5'},{p:[0,1.5,-20],s:[8,1,8],c:'#e04f4f'},{p:[0,2.5,-28],s:[8,1,8],c:'#4f7fe0'}]};
const BC={1:'F2F3F3',5:'D7C59A',18:'CC8E69',21:'C4281C',23:'0D69AC',24:'F5CD30',26:'1B2A35',28:'287F47',37:'4B974B',106:'DA8541',107:'008F9C',119:'A4BD47',125:'EAB892',192:'694028',194:'A3A2A5',199:'635F62',208:'E5E4DF',217:'7C5C46',226:'FDEA8D',1001:'F8F8F8',1002:'CDCDCD',1003:'111111',1004:'FF0000',1009:'FFFF00',1010:'0000FF',1012:'2154B9',1013:'04AFEC',1015:'AA00AA',1018:'12EED4'};
const bc2=id=>'#'+(BC[id]||'CC8E69');
const sessions=new Map(),adminTok=new Set(),caps=new Map();
const SRV=[1,2,3,4,5].map(id=>({id,max:20,players:new Map(),built:[],nid:1}));
let pid=0;
const app=express();app.use(express.json({limit:'10kb'}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/admin',(q,r)=>r.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/api/captcha',(q,r)=>{const a=1+Math.random()*9|0,b=1+Math.random()*9|0,c=2+Math.random()*7|0,id=rnd();caps.set(id,{v:a*b+c,e:Date.now()+3e5});if(caps.size>5000)caps.clear();r.json({id,q:`${a} × ${b} + ${c} = ?`})});
const chk=(id,ans)=>{const c=caps.get(id);caps.delete(id);return !!c&&c.e>Date.now()&&+ans===c.v};
const auth=(q,r,n)=>{const u=sessions.get(q.headers['x-token']);if(!u||!db.users[u])return r.status(401).json({e:'Please log in'});q.user=u;n()};
const tries={};const limited=ip=>{const t=tries[ip]=(tries[ip]||[]).filter(x=>x>Date.now()-6e4);t.push(Date.now());return t.length>10};
app.post('/api/register',(q,r)=>{const{user,pass,cid,ans}=q.body;
 if(limited(q.ip))return r.status(429).json({e:'Too many attempts'});
 if(!chk(cid,ans))return r.status(400).json({e:'Human verification failed'});
 if(!/^[A-Za-z0-9_]{3,16}$/.test(user||''))return r.status(400).json({e:'Username: 3-16 letters/numbers/_'});
 if(typeof pass!=='string'||pass.length<6)return r.status(400).json({e:'Password must be 6+ characters'});
 if(db.users[user.toLowerCase()])return r.status(400).json({e:'Username taken'});
 const s=rnd();db.users[user.toLowerCase()]={s,h:hs(pass,s),rbx:null};save();
 const t=rnd();sessions.set(t,user.toLowerCase());r.json({token:t,rbx:null})});
app.post('/api/login',(q,r)=>{const{user,pass,cid,ans}=q.body;
 if(limited(q.ip))return r.status(429).json({e:'Too many attempts'});
 if(!chk(cid,ans))return r.status(400).json({e:'Human verification failed'});
 const u=db.users[String(user||'').toLowerCase()];
 if(!u||typeof pass!=='string'||!same(hs(pass,u.s),u.h))return r.status(400).json({e:'Wrong username or password'});
 const t=rnd();sessions.set(t,user.toLowerCase());r.json({token:t,rbx:u.rbx})});
app.get('/api/me',auth,(q,r)=>r.json({user:q.user,rbx:db.users[q.user].rbx}));
app.post('/api/roblox',auth,async(q,r)=>{try{
 const name=String(q.body.name||'').trim();if(!/^[A-Za-z0-9_]{3,20}$/.test(name))return r.status(400).json({e:'Invalid Roblox username'});
 const u=await(await fetch('https://users.roblox.com/v1/usernames/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usernames:[name],excludeBannedUsers:true})})).json();
 const f=u.data&&u.data[0];if(!f)return r.status(404).json({e:'Roblox user not found'});
 const[av,th]=await Promise.all([fetch(`https://avatar.roblox.com/v1/users/${f.id}/avatar`).then(x=>x.json()),fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${f.id}&size=150x150&format=Png`).then(x=>x.json())]);
 const b=av.bodyColors||{};
 const rbx={name:f.name,id:f.id,img:(th.data&&th.data[0]&&th.data[0].imageUrl)||'',colors:{h:bc2(b.headColorId),t:bc2(b.torsoColorId),ra:bc2(b.rightArmColorId),la:bc2(b.leftArmColorId),rl:bc2(b.rightLegColorId),ll:bc2(b.leftLegColorId)}};
 db.users[q.user].rbx=rbx;save();r.json({rbx})}catch(e){r.status(502).json({e:'Could not reach Roblox, try again'})}});
app.get('/api/servers',(q,r)=>r.json({online:SRV.reduce((n,s)=>n+s.players.size,0),servers:SRV.map(s=>({id:s.id,players:s.players.size,max:s.max}))}));
/* ---- admin ---- */
const adm=(q,r,n)=>adminTok.has(q.headers['x-admin'])?n():r.status(401).json({e:'Not authorised'});
app.post('/api/admin/login',(q,r)=>{if(limited('a'+q.ip))return r.status(429).json({e:'Too many attempts'});
 const p=String(q.body.password||'');if(!same(hs(p,db.admin.s),db.admin.h))return r.status(400).json({e:'Wrong password'});
 const t=rnd();adminTok.add(t);r.json({token:t})});
app.get('/api/admin/stats',adm,(q,r)=>r.json({users:Object.keys(db.users).length,online:SRV.reduce((n,s)=>n+s.players.size,0),parts:db.world.parts.length}));
app.post('/api/admin/password',adm,(q,r)=>{const p=String(q.body.password||'');if(p.length<8)return r.status(400).json({e:'Use 8+ characters'});setAdmin(p);r.json({ok:1})});
app.post('/api/admin/upload',adm,express.raw({type:'*/*',limit:'100mb'}),(q,r)=>{
 const b=q.body;if(!Buffer.isBuffer(b)||!b.length)return r.status(400).json({e:'Empty file'});
 if(b.slice(0,8).toString()==='<roblox!')return r.status(400).json({e:'Binary .rbxl is not supported. In Studio use File > Save As > "Roblox XML Place Files (*.rbxlx)".'});
 const w=parseRbxlx(b.toString('utf8'));if(!w.parts.length)return r.status(400).json({e:'No Parts found in file'});
 db.world=w;save();for(const s of SRV){s.built=[];bc(s,{t:'w',world:w})}r.json({ok:1,parts:w.parts.length})});
function parseRbxlx(x){const parts=[];let spawn=null;const re=/<Item class="(Part|MeshPart|WedgePart|CornerWedgePart|TrussPart|SpawnLocation)"[^>]*>([\s\S]*?)<\/Item>/g;let m;
 const num=(s,t)=>{const k=new RegExp(`<${t}>([-\\d.eE+]+)</${t}>`).exec(s);return k?+k[1]:0};
 while((m=re.exec(x))&&parts.length<8000){const b=m[2];
  const cf=/<CoordinateFrame name="CFrame">([\s\S]*?)<\/CoordinateFrame>/.exec(b),sz=/<Vector3 name="size">([\s\S]*?)<\/Vector3>/i.exec(b);if(!cf||!sz)continue;
  const tr=/<float name="Transparency">([-\d.eE+]+)</.exec(b);if(tr&&+tr[1]>=.95)continue;
  const p=[num(cf[1],'X'),num(cf[1],'Y'),num(cf[1],'Z')],s=[num(sz[1],'X'),num(sz[1],'Y'),num(sz[1],'Z')];
  const cu=/<Color3uint8 name="Color3uint8">(\d+)</.exec(b);const c='#'+(cu?(+cu[1]&0xFFFFFF).toString(16).padStart(6,'0'):'a3a2a5');
  parts.push({p,s,c});if(m[1]==='SpawnLocation'&&!spawn)spawn=[p[0],p[1]+s[1]/2+4,p[2]]}
 return{spawn:spawn||[0,20,0],parts}}
/* ---- realtime ---- */
const server=http.createServer(app),wss=new WebSocketServer({server,path:'/ws'});
const tx=(w,o)=>w.readyState===1&&w.send(JSON.stringify(o));
function bc(S,o,ex){for(const p of S.players.values())if(p.ws!==ex)tx(p.ws,o)}
wss.on('connection',(ws,req)=>{
 const q=new URL(req.url,'http://x').searchParams,name=sessions.get(q.get('token')),S=SRV[(+q.get('server'))-1],u=db.users[name];
 if(!u||!u.rbx||!S||S.players.size>=S.max)return ws.close(4000);
 for(const s of SRV)for(const p of s.players.values())if(p.name===name)p.ws.close(4001);
 const id=++pid,pl={id,name,ws,c:u.rbx.colors,rn:u.rbx.name,p:[0,6,0,0,0],last:0};S.players.set(id,pl);
 tx(ws,{t:'init',id,world:db.world,built:S.built,players:[...S.players.values()].filter(x=>x!==pl).map(x=>({id:x.id,n:x.rn,c:x.c}))});
 bc(S,{t:'j',id,n:pl.rn,c:pl.c},ws);
 const nums=a=>Array.isArray(a)&&a.length===3&&a.every(v=>Number.isFinite(v)&&Math.abs(v)<1e5);
 ws.on('message',d=>{let m;try{m=JSON.parse(d)}catch{return}
  if(m.t==='m'&&nums(m.p)&&Number.isFinite(m.r))pl.p=[...m.p,m.r,m.a|0];
  else if(m.t==='chat'&&typeof m.m==='string'&&Date.now()-pl.last>700){pl.last=Date.now();const x=m.m.trim().slice(0,200);if(x)bc(S,{t:'c',n:pl.rn,m:x})}
  else if(m.t==='build'&&nums(m.p)&&/^#[0-9a-f]{6}$/i.test(m.c)&&S.built.length<2000){const b={i:S.nid++,p:m.p,c:m.c};S.built.push(b);bc(S,{t:'b',...b})}
  else if(m.t==='del'){const k=S.built.findIndex(b=>b.i===m.i);if(k>=0){S.built.splice(k,1);bc(S,{t:'d',i:m.i})}}});
 ws.on('close',()=>{if(S.players.get(id)===pl){S.players.delete(id);bc(S,{t:'l',id})}});
});
setInterval(()=>{for(const S of SRV)if(S.players.size){const s={};for(const p of S.players.values())s[p.id]=p.p;bc(S,{t:'s',s})}},66);
server.listen(process.env.PORT||3000,()=>console.log('BloxWeb up'));
