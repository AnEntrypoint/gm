const fs=require('fs'),path=require('path');
function find(dir){
  try{const e=fs.readdirSync(dir,{withFileTypes:true});let f=[];
  for(const x of e){const full=path.join(dir,x.name);
  if(x.isDirectory()&&!['target','.git'].includes(x.name))f=f.concat(find(full));
  else if(x.isFile()&&x.name.endsWith('.rs'))f.push(full);}return f;}catch(e){return[];}
}
function scan(p){
  try{const c=fs.readFileSync(p,'utf8');
  const blocks=[];let i=0;const ls=c.split('\n');
  while(i<ls.length){
    if(/extern\s+"C"/.test(ls[i])){
      const above=ls.slice(Math.max(0,i-3),i).join('\n');
      const hasLink=/wasm_import_module/.test(above);
      blocks.push({f:p.replace(/\\/g,'/'),n:i+1,hasLink,ctx:ls[i].trim()});
    }
    i++;
  }
  return blocks;}catch(e){return[];}
}
const repos=['C:/dev/rs-plugkit','C:/dev/rs-learn','C:/dev/rs-exec','C:/dev/rs-search','C:/dev/rs-codeinsight'];
const all=[];for(const r of repos)for(const f of find(r))all.push(...scan(f));
const missing=all.filter(x=>!x.hasLink);
process.stdout.write(JSON.stringify({all:all.length,missing}));
