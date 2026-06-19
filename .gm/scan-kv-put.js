const fs=require('fs'),path=require('path');
function find(dir){
  try{const e=fs.readdirSync(dir,{withFileTypes:true});let f=[];
  for(const x of e){const full=path.join(dir,x.name);
  if(x.isDirectory()&&!['target','.git'].includes(x.name))f=f.concat(find(full));
  else if(x.isFile()&&x.name.endsWith('.rs'))f.push(full);}return f;}catch(e){return[];}
}
function scan(p){
  try{const c=fs.readFileSync(p,'utf8');const ls=c.split('\n');
  const r=[];ls.forEach((l,i)=>{if(/host_kv_put/.test(l))r.push({f:p.replace(/\\/g,'/'),n:i+1,c:l.trim()});});
  return r;}catch(e){return[];}
}
const repos=['C:/dev/rs-plugkit','C:/dev/rs-learn','C:/dev/rs-exec','C:/dev/rs-search'];
const all=[];for(const r of repos)for(const f of find(r))all.push(...scan(f));
process.stdout.write(JSON.stringify(all));
